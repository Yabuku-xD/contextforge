import http from "node:http";
import { URL } from "node:url";
import { createContextForge } from "../contextforge.js";

export async function startBridgeServer(rootDir: string, options: Record<string, any> = {}): Promise<any> {
  const host = options.host ?? "127.0.0.1";
  const port = normalizePort(options.port);
  const forge = createContextForge(rootDir, options.sessionId ? { sessionId: options.sessionId } : {});

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port || 0}`}`);
    try {
      const payload = await handleRequest(forge, url);
      writeJson(response, 200, payload);
    } catch (error) {
      writeJson(response, error.statusCode ?? 500, {
        error: error.message
      });
    }
  });

  await new Promise<void>((resolve) => server.listen(port, host, () => resolve()));
  const address = server.address();
  const resolvedPort = typeof address === "object" && address ? address.port : port;

  return {
    host,
    port: resolvedPort,
    url: `http://${host}:${resolvedPort}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        forge.close();
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    })
  };
}

async function handleRequest(forge, url) {
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  if (pathname === "/health") {
    return {
      ok: true,
      repoId: forge.repoId,
      sessionId: forge.sessionId
    };
  }

  if (pathname === "/api/overview") {
    return forge.scan(url.searchParams.get("q") ?? "repo overview");
  }

  if (pathname === "/api/areas") {
    return forge.areas(url.searchParams.get("q") ?? "");
  }

  if (pathname === "/api/flows") {
    return forge.flows(url.searchParams.get("q") ?? "");
  }

  if (pathname === "/api/schema") {
    return forge.graphSchema();
  }

  if (pathname === "/api/search") {
    return forge.search(url.searchParams.get("q") ?? "", {
      limit: url.searchParams.get("limit")
    });
  }

  if (pathname === "/api/impact") {
    return forge.impact(url.searchParams.get("q") ?? "");
  }

  if (pathname === "/api/changes") {
    return forge.changes({
      scope: url.searchParams.get("scope") ?? "unstaged",
      baseRef: url.searchParams.get("base")
    });
  }

  if (pathname === "/api/map") {
    return forge.map(url.searchParams.get("q") ?? "");
  }

  if (pathname === "/api/wiki") {
    return forge.wiki(url.searchParams.get("q") ?? "");
  }

  if (pathname === "/api/contracts") {
    return forge.contracts(url.searchParams.get("q") ?? "");
  }

  throw Object.assign(new Error(`Unknown route: ${pathname}`), { statusCode: 404 });
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function normalizePort(value) {
  if (value == null) {
    return 0;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}
