import os from "node:os";
import path from "node:path";
import { ensureDir, exists, readText, writeText } from "../utils/fs.js";

function contextforgeHome() {
  const homeDir = path.join(os.homedir(), ".contextforge");
  ensureDir(homeDir);
  return homeDir;
}

function registryFile() {
  return path.join(contextforgeHome(), "registry.json");
}

function groupsFile() {
  return path.join(contextforgeHome(), "groups.json");
}

function rootsFile() {
  return path.join(contextforgeHome(), "registry-roots.json");
}

function readJson(filePath: string, fallback: any) {
  if (!exists(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(readText(filePath));
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, value: any) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function allowEphemeralRegistryRepos() {
  return String(process.env.CONTEXTFORGE_REGISTER_TEMP_REPOS ?? "").trim() === "1";
}

function isEphemeralRepositoryRoot(rootPath) {
  const absolute = path.resolve(String(rootPath ?? ""));
  if (!absolute) {
    return true;
  }
  const tmpRoot = path.resolve(os.tmpdir());
  const relative = path.relative(tmpRoot, absolute);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function readRegistryRepos() {
  const payload = readJson(registryFile(), { repos: [] });
  return Array.isArray(payload.repos)
    ? payload.repos.map((entry) => ({
        name: entry.name,
        repoId: entry.repoId,
        fileCount: entry.fileCount,
        symbolCount: entry.symbolCount,
        edgeCount: entry.edgeCount,
        raptorNodeCount: entry.raptorNodeCount,
        indexStatus: entry.indexStatus,
        indexedAt: entry.indexedAt
      }))
    : [];
}

function readRegistryRoots() {
  const payload = readJson(rootsFile(), { roots: [] });
  if (Array.isArray(payload.roots)) {
    return payload.roots;
  }
  const legacy = readJson(registryFile(), { repos: [] });
  return Array.isArray(legacy.repos)
    ? legacy.repos
        .filter((entry) => entry?.repoId && entry?.rootPath)
        .map((entry) => ({
          repoId: entry.repoId,
          rootPath: entry.rootPath
        }))
    : [];
}

function writeRegistryState(repos, roots) {
  writeJson(registryFile(), { repos });
  writeJson(rootsFile(), { roots });
}

function pruneRegistryState() {
  const allowEphemeral = allowEphemeralRegistryRepos();
  const roots = readRegistryRoots()
    .map((entry) => ({
      repoId: entry.repoId,
      rootPath: path.resolve(String(entry.rootPath ?? ""))
    }))
    .filter((entry) => entry.repoId && entry.rootPath && exists(entry.rootPath))
    .filter((entry) => allowEphemeral || !isEphemeralRepositoryRoot(entry.rootPath));
  const visibleRepoIds = new Set(roots.map((entry) => entry.repoId));
  const repos = readRegistryRepos()
    .filter((entry) => entry.repoId && visibleRepoIds.has(entry.repoId))
    .map((entry) => ({
      name: entry.name,
      repoId: entry.repoId,
      fileCount: Number(entry.fileCount ?? 0),
      symbolCount: Number(entry.symbolCount ?? 0),
      edgeCount: Number(entry.edgeCount ?? 0),
      raptorNodeCount: Number(entry.raptorNodeCount ?? 0),
      indexStatus: entry.indexStatus ?? "ready",
      indexedAt: Number(entry.indexedAt ?? Date.now())
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return { repos, roots };
}

export function listRegisteredRepositories(options: Record<string, any> = {}): any[] {
  const includePaths = Boolean(options.includePaths);
  const { repos, roots } = pruneRegistryState();
  const rootByRepoId = new Map(roots.map((entry) => [entry.repoId, entry.rootPath]));
  return repos.map((repo) => includePaths
    ? {
        ...repo,
        rootPath: rootByRepoId.get(repo.repoId) ?? null
      }
    : repo);
}

export function registerIndexedRepository(repo): any {
  const { repos: existingRepos, roots: existingRoots } = pruneRegistryState();
  const nextRepo = {
    name: repo.name,
    repoId: repo.repoId,
    fileCount: Number(repo.fileCount ?? 0),
    symbolCount: Number(repo.symbolCount ?? 0),
    edgeCount: Number(repo.edgeCount ?? 0),
    raptorNodeCount: Number(repo.raptorNodeCount ?? 0),
    indexStatus: repo.indexStatus ?? "ready",
    indexedAt: Number(repo.indexedAt ?? Date.now())
  };
  const resolvedRootPath = path.resolve(String(repo.rootPath ?? ""));
  const allowEphemeral = allowEphemeralRegistryRepos();

  const repos = existingRepos.filter((entry) => entry.repoId !== nextRepo.repoId);
  const roots = existingRoots.filter((entry) =>
    entry.repoId !== nextRepo.repoId &&
    path.resolve(entry.rootPath) !== resolvedRootPath);

  if (resolvedRootPath && exists(resolvedRootPath) && (allowEphemeral || !isEphemeralRepositoryRoot(resolvedRootPath))) {
    repos.push(nextRepo);
    roots.push({
      repoId: nextRepo.repoId,
      rootPath: resolvedRootPath
    });
  }

  repos.sort((left, right) => left.name.localeCompare(right.name));
  roots.sort((left, right) => left.repoId.localeCompare(right.repoId));
  writeRegistryState(repos, roots);
  return nextRepo;
}

export function resolveRegisteredRepository(repoRef): any {
  const normalized = String(repoRef ?? "").trim();
  if (!normalized) {
    return null;
  }

  const absolute = path.resolve(normalized);
  return listRegisteredRepositories({ includePaths: true }).find((repo) =>
    repo.repoId === normalized ||
    repo.name === normalized ||
    path.resolve(repo.rootPath) === absolute
  ) ?? null;
}

export function listRepoGroups(name = null): any {
  const payload = readJson(groupsFile(), { groups: [] });
  const groups = Array.isArray(payload.groups) ? payload.groups : [];
  const normalizedGroups = groups.map((group) => ({
    name: group.name,
    repos: Array.isArray(group.repos)
      ? group.repos
          .filter((entry) => entry?.repoId && entry?.name)
          .map((entry) => ({
            repoId: entry.repoId,
            name: entry.name
          }))
      : [],
    createdAt: group.createdAt ?? Date.now(),
    updatedAt: group.updatedAt ?? Date.now()
  }));
  if (!name) {
    return normalizedGroups;
  }
  return normalizedGroups.find((group) => group.name === name) ?? null;
}

export function createRepoGroup(name): any {
  const normalized = normalizeGroupName(name);
  const groups = listRepoGroups();
  const existing = groups.find((group) => group.name === normalized);
  if (existing) {
    return existing;
  }

  const created = {
    name: normalized,
    repos: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  groups.push(created);
  groups.sort((left, right) => left.name.localeCompare(right.name));
  writeJson(groupsFile(), { groups });
  return created;
}

export function addRepoToGroup(name, repoRef): any {
  const normalized = normalizeGroupName(name);
  const repo = typeof repoRef === "string" ? resolveRegisteredRepository(repoRef) : repoRef;
  if (!repo) {
    throw new Error(`Unknown registered repository: ${repoRef}`);
  }

  const groups = listRepoGroups();
  const index = groups.findIndex((group) => group.name === normalized);
  const group = index >= 0 ? groups[index] : createRepoGroup(normalized);
  const repos = Array.isArray(group.repos) ? [...group.repos] : [];
  if (!repos.some((entry) => entry.repoId === repo.repoId)) {
    repos.push({
      repoId: repo.repoId,
      name: repo.name
    });
  }

  const updated = {
    ...group,
    repos: repos.sort((left, right) => left.name.localeCompare(right.name)),
    updatedAt: Date.now()
  };
  if (index >= 0) {
    groups[index] = updated;
  } else {
    groups.push(updated);
  }
  groups.sort((left, right) => left.name.localeCompare(right.name));
  writeJson(groupsFile(), { groups });
  return updated;
}

export function removeRepoFromGroup(name, repoRef): any {
  const normalized = normalizeGroupName(name);
  const repo = typeof repoRef === "string" ? resolveRegisteredRepository(repoRef) : repoRef;
  const groups = listRepoGroups();
  const index = groups.findIndex((group) => group.name === normalized);
  if (index < 0) {
    throw new Error(`Unknown group: ${normalized}`);
  }

  const group = groups[index];
  const repos = (group.repos ?? []).filter((entry) => {
    if (!repo) {
      return entry.repoId !== repoRef && entry.name !== repoRef;
    }
    return entry.repoId !== repo.repoId;
  });
  const updated = {
    ...group,
    repos,
    updatedAt: Date.now()
  };
  groups[index] = updated;
  writeJson(groupsFile(), { groups });
  return updated;
}

function normalizeGroupName(name) {
  const normalized = String(name ?? "").trim();
  if (!normalized) {
    throw new Error("Group name must be non-empty.");
  }
  return normalized;
}
