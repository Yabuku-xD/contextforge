import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function findProjectRoot(moduleUrl): string {
  let currentDir = path.dirname(fileURLToPath(moduleUrl));

  while (true) {
    const packageJsonPath = path.join(currentDir, "package.json");
    const srcDirPath = path.join(currentDir, "src");

    if (fs.existsSync(packageJsonPath) && fs.existsSync(srcDirPath)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Unable to resolve project root from ${moduleUrl}`);
    }
    currentDir = parentDir;
  }
}

export function resolveProjectPath(moduleUrl, ...segments): string {
  return path.join(findProjectRoot(moduleUrl), ...segments);
}
