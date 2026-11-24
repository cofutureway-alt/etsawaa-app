// postbuild: a build made on Windows bakes "build\client" (backslash) into
// the server bundle as assetsBuildDirectory; on the Linux server that path
// does not exist and every /assets/* request 404s. Normalize to "/".
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join("build", "server", "assets");
let fixed = 0;
for (const name of readdirSync(dir)) {
  if (!name.endsWith(".js")) continue;
  const file = join(dir, name);
  const src = readFileSync(file, "utf8");
  const out = src.replaceAll(String.raw`"build\\client"`, '"build/client"');
  if (out !== src) { writeFileSync(file, out); fixed += 1; }
}
console.log(`fix-build-paths: ${fixed} file(s) normalized`);
