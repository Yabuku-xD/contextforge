import path from "node:path";

const IMPORT_RE = /^\s*import\s+(.+?)\s+from\s+["'](.+?)["'];?/gm;
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];

export function parseImports(content): any[] {
  const specs = [];
  for (const match of String(content ?? "").matchAll(IMPORT_RE)) {
    const clause = match[1].trim();
    const sourcePath = match[2];
    for (const spec of parseImportClause(clause)) {
      specs.push({
        ...spec,
        sourcePath
      });
    }
  }

  return specs;
}

export function resolveImportTargetFile(currentRelativePath, importedPath, files): any {
  if (!importedPath?.startsWith(".")) {
    return null;
  }

  const byRelativePath = new Map(files.map((file) => [normalizePath(file.relativePath), file]));
  const absoluteLike = normalizePath(path.join(path.dirname(currentRelativePath), importedPath));
  const candidates = [
    absoluteLike,
    ...EXTENSIONS.map((ext) => `${absoluteLike}${ext}`),
    ...EXTENSIONS.map((ext) => path.join(absoluteLike, `index${ext}`))
  ];

  for (const candidate of candidates) {
    const resolved = byRelativePath.get(normalizePath(candidate));
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function parseImportClause(clause) {
  if (clause.startsWith("{")) {
    return parseNamedImports(clause);
  }

  if (clause.startsWith("* as ")) {
    return [{ importedName: "*", localName: clause.slice(5).trim(), kind: "namespace" }];
  }

  if (clause.includes(",")) {
    const [defaultPart, rest] = clause.split(/,(.+)/).map((part) => part?.trim()).filter(Boolean);
    return [
      ...(defaultPart ? [{ importedName: "default", localName: defaultPart, kind: "default" }] : []),
      ...(rest?.startsWith("{") ? parseNamedImports(rest) : rest?.startsWith("* as ") ? [{ importedName: "*", localName: rest.slice(5).trim(), kind: "namespace" }] : [])
    ];
  }

  return [{ importedName: "default", localName: clause, kind: "default" }];
}

function parseNamedImports(clause) {
  const body = clause.replace(/^{|}$/g, "").trim();
  if (!body) {
    return [];
  }

  return body
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [importedName, localName] = part.split(/\s+as\s+/i).map((item) => item.trim());
      return {
        importedName,
        localName: localName ?? importedName,
        kind: "named"
      };
    });
}

function normalizePath(filePath) {
  return String(filePath ?? "").replace(/\\/g, "/");
}
