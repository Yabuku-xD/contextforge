import crypto from "node:crypto";

export function sha1(value): string {
  return crypto.createHash("sha1").update(String(value ?? "")).digest("hex");
}

export function hashObject(value): string {
  return sha1(JSON.stringify(value));
}
