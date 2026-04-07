const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9]{16,}\b/g,
  /\bghp_[A-Za-z0-9]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /password\s*[:=]\s*["'][^"']+["']/gi
];

export function redactSecrets(value): string {
  let text = String(value ?? "");
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, "[REDACTED]");
  }
  return text;
}

export function redactSecretsDeep(value: any): any {
  if (typeof value === "string") {
    return redactSecrets(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecretsDeep(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactSecretsDeep(item)])
    );
  }

  return value;
}
