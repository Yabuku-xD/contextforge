export function cacheLayout({ coreInstructions, modules = [], toolSchemas = [] }) {
  return {
    prefix: [coreInstructions, ...modules].filter(Boolean),
    suffix: toolSchemas.filter(Boolean)
  };
}
