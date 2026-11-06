import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { buildSite } from "../src/build.js";
import { signAllSourceSchema } from "../src/schema.js";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const distDir = join(rootDir, "dist");
const wranglerEntry = join(
  rootDir,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);

async function getFreePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a local port"));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolvePort(port);
        }
      });
    });
  });
}

function stopProcess(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    spawnSync(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      { stdio: "ignore" },
    );
    return;
  }

  child.kill("SIGTERM");
}

async function waitForServer(
  sourceUrl: string,
  child: ChildProcess,
  logs: () => string,
): Promise<void> {
  const deadline = Date.now() + 45_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`wrangler exited early.\n${logs()}`);
    }

    try {
      const response = await fetch(sourceUrl, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // The local Pages server is still starting.
    }

    await delay(500);
  }

  throw new Error(`Timed out waiting for wrangler pages dev.\n${logs()}`);
}

async function main(): Promise<void> {
  if (!existsSync(wranglerEntry)) {
    throw new Error("Wrangler is not installed. Run npm install first.");
  }

  const publicBaseUrl = "https://signall.example.com";
  const r2PublicBaseUrl = "https://ipa.example.com";
  await buildSite({
    rootDir,
    distDir,
    publicBaseUrl,
    r2PublicBaseUrl,
  });

  const port = await getFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const sourceUrl = `${origin}/appstore`;
  let output = "";
  const child = spawn(
    process.execPath,
    [
      wranglerEntry,
      "pages",
      "dev",
      resolve(distDir),
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--log-level",
      "error",
    ],
    {
      cwd: rootDir,
      env: { ...process.env, CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  const collect = (chunk: Buffer): void => {
    output += chunk.toString();
    if (output.length > 20_000) {
      output = output.slice(-20_000);
    }
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);

  try {
    await waitForServer(sourceUrl, child, () => output);

    const getResponse = await fetch(`${sourceUrl}?udid=probe`);
    if (!getResponse.ok) {
      throw new Error(`GET ${sourceUrl} returned ${getResponse.status}`);
    }
    if (
      !getResponse.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/json")
    ) {
      throw new Error(
        `GET ${sourceUrl} returned unexpected Content-Type '${getResponse.headers.get("content-type")}'`,
      );
    }

    const getJson = await getResponse.json();
    const source = signAllSourceSchema.parse(getJson);

    const postResponse = await fetch(sourceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!postResponse.ok) {
      throw new Error(`POST ${sourceUrl} returned ${postResponse.status}`);
    }
    const postSource = signAllSourceSchema.parse(await postResponse.json());
    if (JSON.stringify(source) !== JSON.stringify(postSource)) {
      throw new Error("GET and POST source payloads differ");
    }

    const headResponse = await fetch(sourceUrl, { method: "HEAD" });
    if (!headResponse.ok || (await headResponse.text()) !== "") {
      throw new Error("HEAD /appstore did not return an empty successful response");
    }

    const redirectResponse = await fetch(origin, { redirect: "manual" });
    if (redirectResponse.status !== 302) {
      throw new Error(`GET / returned ${redirectResponse.status}, expected 302`);
    }
    if (!redirectResponse.headers.get("location")?.endsWith("/appstore")) {
      throw new Error("GET / did not redirect to /appstore");
    }

    const iconResponse = await fetch(`${origin}/icons/source.png`);
    if (!iconResponse.ok) {
      throw new Error(`Source icon returned ${iconResponse.status}`);
    }

    const methodResponse = await fetch(sourceUrl, { method: "PUT" });
    if (methodResponse.status !== 405) {
      throw new Error(`PUT /appstore returned ${methodResponse.status}, expected 405`);
    }

    const jsonPathResponse = await fetch(`${origin}/appstore.json`);
    if (
      !jsonPathResponse.ok ||
      signAllSourceSchema.parse(await jsonPathResponse.json()).identifier !==
        source.identifier
    ) {
      throw new Error("/appstore.json did not return the same source identifier");
    }

    console.log(
      `Pages smoke test passed: ${source.apps.length} app version(s), GET/POST/HEAD, redirect, icon, and method handling.`,
    );
  } finally {
    stopProcess(child);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
