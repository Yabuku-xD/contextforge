import fs from "node:fs";
import path from "node:path";

const DEFAULT_IGNORES = new Set([
  ".git",
  ".contextforge",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
  "coverage"
]);

export function exists(filePath): boolean {
  return fs.existsSync(filePath);
}

export function ensureDir(dirPath): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function readText(filePath): string {
  return fs.readFileSync(filePath, "utf8");
}

export function writeText(filePath, content): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

export function walkFiles(rootDir): string[] {
  const output = [];

  function visit(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (DEFAULT_IGNORES.has(entry.name)) {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }

      output.push(fullPath);
    }
  }

  visit(rootDir);
  return output;
}

export function relativeTo(rootDir, filePath): string {
  return path.relative(rootDir, filePath) || ".";
}
