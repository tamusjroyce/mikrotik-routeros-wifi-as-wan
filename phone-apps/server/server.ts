import { undoScriptFilePath, webRoot } from "./paths.ts";
import { RouterClient } from "./router-client.ts";

const port = Number(Deno.env.get("PHONE_APP_PORT") ?? "8787");

console.log(`Phone app static server listening on http://localhost:${port}`);

Deno.serve({ port }, async (request) => {
  try {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true });
    }

    if (url.pathname === "/api/router/status" && request.method === "POST") {
      const body = await request.json();
      const routerClient = createRouterClient(body);
      return json(await routerClient.getStatus());
    }

    if (url.pathname === "/api/router/apply" && request.method === "POST") {
      const body = await request.json() as {
        url?: string;
        username?: string;
        password?: string;
        scriptFile?: string;
        content?: string;
      };
      if (typeof body.content !== "string" || !body.content.trim()) {
        return json({ error: "Script content is required." }, 400);
      }

      const routerClient = createRouterClient(body);
      return json(await routerClient.applyScriptContent(body.content));
    }

    if (url.pathname === "/api/router/undo" && request.method === "POST") {
      const body = await request.json();
      const routerClient = createRouterClient({
        ...body,
        scriptFile: body?.scriptFileUndo ?? "undo-wifi-as-wan.rsc",
      });
      return json(await routerClient.applyScript(undoScriptFilePath));
    }

    return await serveStatic(url.pathname);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

function createRouterClient(settings: {
  url?: string;
  username?: string;
  password?: string;
  scriptFile?: string;
}): RouterClient {
  return new RouterClient({
    url: settings.url ?? Deno.env.get("ROUTER_URL") ?? "http://192.168.88.1",
    username: settings.username ?? Deno.env.get("ROUTER_USER") ?? "admin",
    password: settings.password ?? Deno.env.get("ROUTER_PASSWORD") ?? "",
    scriptFile: settings.scriptFile ?? Deno.env.get("ROUTER_SCRIPT_FILE") ??
      "enable-wifi-as-wan.rsc",
  });
}

async function serveStatic(pathname: string): Promise<Response> {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const fileUrl = new URL(`.${cleanPath}`, webRoot);

  if (!fileUrl.pathname.startsWith(webRoot.pathname)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const file = await Deno.readFile(fileUrl);
    return new Response(file, {
      headers: { "Content-Type": contentType(fileUrl.pathname) },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function contentType(pathname: string): string {
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (pathname.endsWith(".json")) return "application/manifest+json; charset=utf-8";
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}
