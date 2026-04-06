let LLMLingua2 = null;

export async function loadLLMLingua2() {
  if (LLMLingua2) {
    return LLMLingua2;
  }

  try {
    const module = await import("@atjsh/llmlingua-2");
    LLMLingua2 = module.LLMLingua2 ?? module.default ?? null;
  } catch {
    LLMLingua2 = null;
  }

  return LLMLingua2;
}

export async function compressWithLLMLingua2(text, options = {}) {
  const Implementation = await loadLLMLingua2();
  if (!Implementation) {
    return null;
  }

  try {
    const instance = new Implementation({
      modelName: options.modelName ?? "atjsh/llmlingua-2-js-tinybert-meetingbank"
    });

    const result = await instance.compress({
      content: String(text ?? ""),
      targetToken: options.targetToken ?? 256
    });

    return result?.compressedPrompt ?? result?.result ?? null;
  } catch {
    return null;
  }
}
