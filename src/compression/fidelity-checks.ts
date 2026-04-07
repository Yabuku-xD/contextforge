import { checkInvariants, extractInvariants } from "../router/invariants.js";

export function runFidelityChecks({ contentType, original, compressed }): any {
  const invariants = extractInvariants(contentType, original);
  return {
    invariants,
    ...checkInvariants(invariants, compressed)
  };
}
