export const MODEL_METADATA = {
  embeddings: {
    default: {
      name: "hash-embedding-v1",
      dimension: 1024
    },
    bgeM3: {
      name: "bge-m3",
      dimension: 1024
    }
  },
  compression: {
    default: {
      name: "llmlingua2-fallback",
      note: "Heuristic fallback when LLMLingua-2 is unavailable or disabled"
    }
  }
};
