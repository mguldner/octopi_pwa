const setup = document.querySelector("#setup");
const dashboard = document.querySelector("#dashboard");
const setupForm = document.querySelector("#setupForm");
const toast = document.querySelector("#toast");
let pollTimer;

function notify(message) {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.headers || {}
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function loadConfig() {
  const config = await api("/api/config");
  setup.hidden = config.configured;
  dashboard.hidden = !config.configured;
  if (config.configured) {
    setupForm.elements.baseUrl.value = config.baseUrl;
    await refreshStatus();
    await refreshFiles();
    clearInterval(pollTimer);
    pollTimer = setInterval(refreshStatus, 3000);
  } else {
    clearInterval(pollTimer);
  }
}

function tempValue(temp) {
  if (!temp) return "--";
  const actual = temp.actual != null ? temp.actual.toFixed(1) : "--";
  const target = temp.target != null ? temp.target.toFixed(1) : "--";
  return `${actual} / ${target}`;
}

async function refreshStatus() {
  try {
    const data = await api("/api/status");
    const printer = data.printer || {};
    const job = data.job || {};
    const state = printer.state?.text || "Inconnu";
    const badge = document.querySelector("#stateBadge");
    badge.textContent = state;
    badge.classList.toggle("online", state !== "Offline" && state !== "Unknown");
    document.querySelector("#toolTemp").textContent = `${tempValue(printer.temperature?.tool0)} °C`;
    document.querySelector("#bedTemp").textContent = `${tempValue(printer.temperature?.bed)} °C`;
    const progress = Math.max(0, Math.min(100, job.progress?.completion || 0));
    document.querySelector("#progressBar").style.width = `${progress}%`;
    document.querySelector("#progressText").textContent = `${Math.round(progress)}%`;
    document.querySelector("#jobName").textContent = job.job?.file?.name || "Aucune impression";
    const remaining = job.progress?.printTimeLeft;
    document.querySelector("#timeText").textContent = remaining
      ? `${Math.floor(remaining / 3600)}h ${Math.floor((remaining % 3600) / 60)}m restantes`
      : "--:-- restantes";
    document.querySelector("#updatedAt").textContent = new Date(data.updatedAt).toLocaleTimeString();
  } catch (error) {
    notify(error.message);
  }
}

setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(setupForm);
  try {
    await api("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl: form.get("baseUrl"), apiKey: form.get("apiKey") })
    });
    setupForm.elements.apiKey.value = "";
    notify("OctoPrint configuré");
    await loadConfig();
  } catch (error) {
    notify(error.message);
  }
});

document.querySelector("#settingsButton").addEventListener("click", () => {
  setup.hidden = false;
  dashboard.hidden = true;
  clearInterval(pollTimer);
});

document.querySelector("#discoverButton").addEventListener("click", async (event) => {
  event.target.disabled = true;
  event.target.textContent = "Recherche...";
  try {
    const data = await api("/api/discover");
    const container = document.querySelector("#instances");
    container.replaceChildren();
    if (!data.instances.length) {
      container.textContent = "Aucune instance détectée.";
    }
    for (const instance of data.instances) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "instance";
      button.textContent = `${instance.name} — ${instance.baseUrl}`;
      button.addEventListener("click", () => {
        setupForm.elements.baseUrl.value = instance.baseUrl;
      });
      container.append(button);
    }
  } catch (error) {
    notify(error.message);
  } finally {
    event.target.disabled = false;
    event.target.textContent = "Chercher sur le réseau";
  }
});

async function sendJob(command, action) {
  try {
    await api("/api/job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, action })
    });
    await refreshStatus();
  } catch (error) {
    notify(error.message);
  }
}

document.querySelector("#startButton").addEventListener("click", () => sendJob("start"));
document.querySelector("#pauseButton").addEventListener("click", () => sendJob("pause", "toggle"));
document.querySelector("#cancelButton").addEventListener("click", () => {
  if (confirm("Annuler l’impression en cours ?")) sendJob("cancel");
});

document.querySelectorAll("[data-command]").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      const payload = button.dataset.command === "home"
        ? { command: "home", axes: [button.dataset.axis] }
        : { command: "M84" };
      await api("/api/printer/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      notify("Commande envoyée");
    } catch (error) {
      notify(error.message);
    }
  });
});

function flattenFiles(files, location, parent = "") {
  const rows = [];
  for (const file of files || []) {
    const filePath = parent ? `${parent}/${file.name}` : file.name;
    if (file.type === "folder") rows.push(...flattenFiles(file.children, location, filePath));
    else rows.push({ name: file.display || file.name, path: filePath, location, file });
  }
  return rows;
}

async function refreshFiles() {
  try {
    const data = await api("/api/files");
    const list = document.querySelector("#fileList");
    list.replaceChildren();
    const rows = [
      ...flattenFiles(data.files, "local")
    ];
    if (!rows.length) {
      list.textContent = "Aucun fichier.";
      return;
    }
    for (const row of rows) {
      const div = document.createElement("div");
      div.className = "file-row";
      const name = document.createElement("span");
      name.textContent = row.name;
      const select = document.createElement("button");
      select.textContent = "Choisir";
      select.addEventListener("click", () => selectFile(row.location, row.path, false));
      const print = document.createElement("button");
      print.textContent = "Lancer";
      print.className = "danger";
      print.addEventListener("click", () => {
        if (confirm(`Lancer ${row.name} ?`)) selectFile(row.location, row.path, true);
      });
      div.append(name, select, print);
      list.append(div);
    }
  } catch (error) {
    notify(error.message);
  }
}

async function selectFile(location, path, print) {
  try {
    await api("/api/files/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location, path, print })
    });
    notify(print ? "Impression lancée" : "Fichier sélectionné");
    await refreshStatus();
  } catch (error) {
    notify(error.message);
  }
}

document.querySelector("#refreshFiles").addEventListener("click", refreshFiles);
document.querySelector("#fileInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append("file", file);
  form.append("location", "local");
  try {
    await api("/api/files", { method: "POST", body: form });
    notify("Fichier téléversé");
    event.target.value = "";
    await refreshFiles();
  } catch (error) {
    notify(error.message);
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

loadConfig().catch((error) => notify(error.message));
