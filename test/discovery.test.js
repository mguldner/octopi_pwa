import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("PWA manifest is valid JSON", () => {
  const manifest = JSON.parse(fs.readFileSync("public/manifest.webmanifest", "utf8"));
  assert.equal(manifest.name, "OctoPi PWA");
  assert.equal(manifest.display, "standalone");
});

test("required PWA assets exist", () => {
  for (const file of ["public/index.html", "public/app.js", "public/styles.css", "public/sw.js", "public/icon.svg"]) {
    assert.equal(fs.existsSync(file), true, `${file} should exist`);
  }
});
