export function parseSession(token) {
  if (!token) {
    throw new Error("missing token");
  }

  return {
    userId: token.split(".")[0],
    issuedAt: Date.now()
  };
}

export function requireUser(token) {
  const session = parseSession(token);
  if (!session.userId) {
    throw new Error("invalid session");
  }

  return session;
}
