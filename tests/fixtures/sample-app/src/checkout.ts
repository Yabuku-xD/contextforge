import { shouldRetry, backoffMs } from "./retry.js";
import { requireUser } from "./auth.js";

export async function createCheckout(token: string, statusCode: number) {
  const session = requireUser(token);
  let attempt = 0;

  while (shouldRetry(statusCode, attempt)) {
    attempt += 1;
    await wait(backoffMs(attempt));
  }

  return {
    userId: session.userId,
    attempt
  };
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
