export function shouldRetry(statusCode, attempt) {
  const retriable = [408, 425, 429, 500, 502, 503, 504];
  if (!retriable.includes(statusCode)) {
    return false;
  }

  return attempt < 3;
}

export function backoffMs(attempt) {
  return 200 * (attempt + 1);
}
