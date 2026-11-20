import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(__dirname, "data");
const configPath = path.join(dataDir, "config.json");
const uploadDir = path.join(dataDir, "uploads");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function normalizeBaseUrl(value) {
  if (!value) return "";
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Use an HTTP or HTTPS URL");
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.origin + url.pathname;
}

async function octoFetch(inputPath, options = {}) {
  const config = readConfig();
  if (!config.baseUrl || !config.apiKey) throw new Error("OctoPrint is not configured");
  const response = await fetch(`${config.baseUrl}${inputPath}`, {
    ...options,
    headers: {
      "X-Api-Key": config.apiKey,
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(Number(process.env.OCTOPRINT_TIMEOUT_MS || 8000))
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OctoPrint ${response.status}: ${text || response.statusText}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function localNetworks() {
  const ranges = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      const parts = entry.address.split(".").map(Number);
      const mask = entry.netmask.split(".").map(Number);
      const network = parts.map((part, i) => part & mask[i]).join(".");
      ranges.push({ network, mask });
    }
  }
  return ranges;
}

async function isOctoPrint(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/api/version`, {
      signal: AbortSignal.timeout(700)
    });
    if (!response.ok) return false;
    const body = await response.json();
    return Boolean(body.api && body.server);
  } catch {
    return false;
  }
}

async function discoverLan() {
  const found = [];
  const candidates = ["octopi.local", "octoprint.local"];
  for (const host of localNetworks()) {
    const [a, b, c, d] = host.network.split(".").map(Number);
    const prefix = host.mask.filter((byte) => byte === 255).length;
    if (prefix >= 24) {
      for (let suffix = 1; suffix < 255; suffix++) {
        candidates.push(`${a}.${b}.${c}.${suffix}`);
      }
    }
  }
  const unique = [...new Set(candidates)];
  for (let i = 0; i < unique.length; i += 40) {
    const batch = unique.slice(i, i + 40);
    await Promise.all(batch.map(async (host) => {
      for (const baseUrl of [`http://${host}`, `http://${host}:5000`]) {
        if (await isOctoPrint(baseUrl)) {
          found.push({ name: host, baseUrl });
          return;
        }
      }
    }));
  }
  return [...new Map(found.map((item) => [item.baseUrl, item])).values()];
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/config", (_req, res) => {
  const config = readConfig();
  res.json({ configured: Boolean(config.baseUrl && config.apiKey), baseUrl: config.baseUrl || "" });
});

app.post("/api/config", (req, res, next) => {
  try {
    const baseUrl = normalizeBaseUrl(req.body.baseUrl);
    const apiKey = String(req.body.apiKey || "").trim();
    if (!apiKey) return res.status(400).json({ error: "API key is required" });
    writeConfig({ baseUrl, apiKey });
    res.json({ configured: true, baseUrl });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/config", (_req, res) => {
  writeConfig({});
  res.json({ configured: false });
});

app.get("/api/discover", async (_req, res, next) => {
  try {
    res.json({ instances: await discoverLan() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/status", async (_req, res, next) => {
  try {
    const [printer, job] = await Promise.all([
      octoFetch("/api/printer"),
      octoFetch("/api/job")
    ]);
    res.json({ printer, job, updatedAt: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/job", async (req, res, next) => {
  try {
    const allowed = new Set(["start", "cancel", "pause", "resume", "restart"]);
    if (!allowed.has(req.body.command)) return res.status(400).json({ error: "Invalid job command" });
    let payload = { command: req.body.command };
    if (req.body.command === "pause" && req.body.action) {
      payload = { command: "pause", action: req.body.action };
    }
    await octoFetch("/api/job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/printer/command", async (req, res, next) => {
  try {
    const payload = {};
    if (req.body.command) payload.command = req.body.command;
    if (req.body.commands) payload.commands = req.body.commands;
    if (req.body.axes) payload.axes = req.body.axes;
    if (!payload.command && !payload.commands) {
      return res.status(400).json({ error: "Printer command is required" });
    }
    await octoFetch("/api/printer/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/files", async (_req, res, next) => {
  try {
    res.json(await octoFetch("/api/files"));
  } catch (error) {
    next(error);
  }
});

const upload = multer({ dest: uploadDir, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });
app.post("/api/files", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "File is required" });
    const config = readConfig();
    const form = new FormData();
    const bytes = await fs.promises.readFile(req.file.path);
    form.append("file", new Blob([bytes], { type: "application/octet-stream" }), req.file.originalname);
    if (req.body.location) form.append("location", req.body.location);
    if (req.body.select === "true") form.append("select", "true");
    if (req.body.print === "true") form.append("print", "true");
    const response = await fetch(`${config.baseUrl}/api/files/${encodeURIComponent(req.body.location || "local")}`, {
      method: "POST",
      headers: { "X-Api-Key": config.apiKey },
      body: form,
      signal: AbortSignal.timeout(Number(process.env.OCTOPRINT_UPLOAD_TIMEOUT_MS || 300000))
    });
    await fs.promises.rm(req.file.path, { force: true });
    if (!response.ok) throw new Error(`OctoPrint ${response.status}: ${await response.text()}`);
    res.status(201).json(await response.json());
  } catch (error) {
    next(error);
  }
});

app.post("/api/files/select", async (req, res, next) => {
  try {
    const { location = "local", path: filePath, print = false } = req.body;
    if (!filePath) return res.status(400).json({ error: "File path is required" });
    await octoFetch(`/api/files/${encodeURIComponent(location)}${filePath.startsWith("/") ? filePath : `/${filePath}`}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "select", print })
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/files/:location/*splat", async (req, res, next) => {
  try {
    await octoFetch(`/api/files/${encodeURIComponent(req.params.location)}/${req.params.splat}`, { method: "DELETE" });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message || "Unexpected error" });
});

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
let server;
if (process.env.TLS_CERT && process.env.TLS_KEY) {
  server = https.createServer({
    cert: fs.readFileSync(process.env.TLS_CERT),
    key: fs.readFileSync(process.env.TLS_KEY)
  }, app);
  server.listen(port, host, () => console.log(`octopi-pwa HTTPS at https://${host}:${port}`));
} else {
  server = http.createServer(app);
  server.listen(port, host, () => console.log(`octopi-pwa HTTP at http://${host}:${port}`));
}
