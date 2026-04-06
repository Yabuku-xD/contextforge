const GENERATED_PATTERNS = [
  /\/dist\//,
  /\/build\//,
  /\/coverage\//,
  /\.min\./,
  /\.d\.ts$/,
  /generated/i
];

const VENDORED_PATTERNS = [
  /\/vendor\//,
  /\/node_modules\//,
  /\/third_party\//
];

export function classifyFileOrigin(filePath) {
  return {
    isGenerated: GENERATED_PATTERNS.some((pattern) => pattern.test(filePath)),
    isVendor: VENDORED_PATTERNS.some((pattern) => pattern.test(filePath))
  };
}
