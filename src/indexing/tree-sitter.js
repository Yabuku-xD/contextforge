import Parser from "tree-sitter";
import JavaScript from "tree-sitter-javascript";
import TypeScriptModule from "tree-sitter-typescript";

const TypeScript = TypeScriptModule.typescript ?? TypeScriptModule;
const TSX = TypeScriptModule.tsx ?? TypeScriptModule;

const PARSERS = new Map();

function parserFor(language, filePath) {
  if (!PARSERS.has(language)) {
    const parser = new Parser();
    if (language === "javascript") {
      parser.setLanguage(JavaScript);
    } else if (language === "typescript") {
      parser.setLanguage(filePath.endsWith(".tsx") ? TSX : TypeScript);
    } else {
      return null;
    }

    PARSERS.set(language, parser);
  }

  return PARSERS.get(language);
}

export function parseSource({ language, filePath, content }) {
  const parser = parserFor(language, filePath);
  if (!parser) {
    return null;
  }

  return parser.parse(content);
}
