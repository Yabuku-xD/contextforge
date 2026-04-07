import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const distRoot = path.join(repoRoot, "dist");

fs.rmSync(distRoot, { recursive: true, force: true });

const tsc = spawnSync("npx", ["tsc", "-p", "tsconfig.json"], {
  cwd: repoRoot,
  stdio: "inherit",
  shell: process.platform === "win32"
});

if (tsc.status !== 0) {
  process.exit(tsc.status ?? 1);
}

copyFile("src/storage/schema.sql");
copyFile("src/memory/schema.sql");

function copyFile(relativePath) {
  const sourcePath = path.join(repoRoot, relativePath);
  const targetPath = path.join(distRoot, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}
