// Copies the self-hosted TinyMCE build (+ the Arabic UI pack) into
// public/vendor/tinymce so the editor loads from our own origin — no Tiny
// Cloud key, no third-party script. Runs on postinstall and before build.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const src = path.join(root, "node_modules", "tinymce");
const out = path.join(root, "public", "vendor", "tinymce");

if (!fs.existsSync(src)) {
  console.warn("[copy-tinymce] tinymce is not installed; skipped");
  process.exit(0);
}
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const entry of ["tinymce.min.js", "icons", "models", "plugins", "skins", "themes", "license.md"]) {
  fs.cpSync(path.join(src, entry), path.join(out, entry), {
    recursive: true,
    // ship the minified files only
    filter: (file) => fs.statSync(file).isDirectory() || !/\.js$/.test(file) || /\.min\.js$/.test(file),
  });
}
const ar = path.join(root, "node_modules", "tinymce-i18n", "langs8", "ar.js");
if (fs.existsSync(ar)) {
  fs.mkdirSync(path.join(out, "langs"), { recursive: true });
  fs.copyFileSync(ar, path.join(out, "langs", "ar.js"));
}
console.log("[copy-tinymce] copied to", path.relative(root, out));
