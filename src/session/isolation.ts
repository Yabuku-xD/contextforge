export function assertSessionIsolation({ expectedRepoId, actualRepoId }) {
  if (expectedRepoId !== actualRepoId) {
    throw new Error(`Session isolation violation: expected ${expectedRepoId}, received ${actualRepoId}`);
  }
}
