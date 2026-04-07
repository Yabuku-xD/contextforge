export function assertSessionIsolation({ expectedRepoId, actualRepoId }): void {
  if (expectedRepoId !== actualRepoId) {
    throw new Error(`Session isolation violation: expected ${expectedRepoId}, received ${actualRepoId}`);
  }
}
