import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerContextForgeResources(server: any, forge: any): void {
  server.registerResource("contextforge-registry-repos", "contextforge://repos", {
    title: "ContextForge Registered Repositories",
    description: "Global registry of repositories indexed by ContextForge.",
    mimeType: "application/json"
  }, async () => ({
    contents: [{
      uri: "contextforge://repos",
      mimeType: "application/json",
      text: JSON.stringify(forge.listRepos(), null, 2)
    }]
  }));

  const repoResources: any[] = [
    ["contextforge-overview", "contextforge://repo/overview", "ContextForge Repo Overview", "Top-level repository overview and index status.", () => forge.scan("repo overview")],
    ["contextforge-areas", "contextforge://repo/areas", "ContextForge Areas", "Derived package and directory areas from the repository graph.", () => forge.areas()],
    ["contextforge-flows", "contextforge://repo/flows", "ContextForge Flows", "Derived execution-flow groups from entrypoints and graph edges.", () => forge.flows()],
    ["contextforge-schema", "contextforge://repo/schema", "ContextForge Graph Schema", "Node and edge type summary for the repository graph.", () => forge.graphSchema()],
    ["contextforge-map", "contextforge://repo/map", "ContextForge Repo Map", "Rendered architecture map preview.", () => forge.map("", { persist: false })],
    ["contextforge-contracts", "contextforge://repo/contracts", "ContextForge Contracts", "Rendered cross-area contract preview.", () => forge.contracts("", { persist: false })]
  ];

  for (const [name, uri, title, description, reader] of repoResources) {
    server.registerResource(name, uri, {
      title,
      description,
      mimeType: "application/json"
    }, async () => ({
      contents: [{
        uri,
        mimeType: "application/json",
        text: JSON.stringify(reader(), null, 2)
      }]
    }));
  }

  server.registerResource("contextforge-group-status", new ResourceTemplate("contextforge://group/{name}/status", {} as any), {
    title: "ContextForge Group Status",
    description: "Status summary for a registered ContextForge repo group.",
    mimeType: "application/json"
  }, async (uri, variables) => ({
    contents: [{
      uri: String(uri),
      mimeType: "application/json",
      text: JSON.stringify(forge.groupStatus(String(variables.name ?? "")), null, 2)
    }]
  }));
}
