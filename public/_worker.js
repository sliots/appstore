const JSON_PATHS = new Set(["/appstore", "/appstore/", "/appstore.json"]);
const ALLOWED_METHODS = "GET, HEAD, POST, OPTIONS";

function jsonHeaders(sourceHeaders, source) {
  const headers = new Headers(sourceHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store, max-age=0, must-revalidate");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-SignAll-Source", source);
  return headers;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.redirect(new URL("/appstore", url), 302);
    }

    if (JSON_PATHS.has(url.pathname)) {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": ALLOWED_METHODS,
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      if (!["GET", "HEAD", "POST"].includes(request.method)) {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: {
            Allow: ALLOWED_METHODS,
            "Content-Type": "text/plain; charset=utf-8",
          },
        });
      }

      const assetUrl = new URL("/appstore.json", url);
      const asset = await env.ASSETS.fetch(
        new Request(assetUrl, {
          method: "GET",
          headers: request.headers,
        }),
      );

      return new Response(request.method === "HEAD" ? null : asset.body, {
        status: asset.status,
        statusText: asset.statusText,
        headers: jsonHeaders(asset.headers, "static-pages"),
      });
    }

    return env.ASSETS.fetch(request);
  },
};
