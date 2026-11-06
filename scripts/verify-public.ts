import { parseArgs } from "node:util";
import { ZodError } from "zod";
import { signAllSourceSchema } from "../src/schema.js";

interface VerifyOptions {
  attempts: number;
  delayMs: number;
  skipAssets: boolean;
  sourceUrl: string;
}

function parseCli(): VerifyOptions {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      attempts: { type: "string", default: "6" },
      delay: { type: "string", default: "5000" },
      "skip-assets": { type: "boolean", default: false },
    },
  });

  const input = positionals[0];
  if (!input) {
    throw new Error(
      "Usage: npm run verify:public -- <https://domain/appstore> [--skip-assets] [--attempts 6] [--delay 5000]",
    );
  }

  let parsedSourceUrl: URL;
  try {
    parsedSourceUrl = new URL(input);
  } catch {
    throw new Error("Source URL must be an absolute HTTP(S) URL");
  }
  if (!["http:", "https:"].includes(parsedSourceUrl.protocol)) {
    throw new Error("Source URL must use HTTP or HTTPS");
  }
  if (parsedSourceUrl.pathname === "/" || parsedSourceUrl.pathname === "") {
    parsedSourceUrl.pathname = "/appstore";
  }

  const attempts = Number(values.attempts);
  const delayMs = Number(values.delay);
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("--attempts must be a positive integer");
  }
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error("--delay must be a non-negative number");
  }

  return {
    attempts,
    delayMs,
    skipAssets: values["skip-assets"],
    sourceUrl: parsedSourceUrl.toString(),
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  return await fetch(url, {
    ...init,
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const field = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${field}: ${issue.message}`;
    })
    .join("\n");
}

async function verifySource(sourceUrl: string) {
  const getResponse = await fetchWithTimeout(`${sourceUrl}?udid=public-verifier`, {
    headers: { "User-Agent": "SignAll-Source-Verifier/1.0" },
  });
  if (!getResponse.ok) {
    throw new Error(`GET source returned HTTP ${getResponse.status}`);
  }
  if (
    !getResponse.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    throw new Error(
      `Source Content-Type is '${getResponse.headers.get("content-type")}', expected application/json`,
    );
  }

  const getBody = await getResponse.json();
  let source;
  try {
    source = signAllSourceSchema.parse(getBody);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(`Source schema mismatch:\n${formatZodError(error)}`);
    }
    throw error;
  }

  const postResponse = await fetchWithTimeout(sourceUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "SignAll-Source-Verifier/1.0",
    },
    body: "{}",
  });
  if (!postResponse.ok) {
    throw new Error(`POST source returned HTTP ${postResponse.status}`);
  }
  const postBody = await postResponse.json();
  if (JSON.stringify(getBody) !== JSON.stringify(postBody)) {
    throw new Error("GET and POST source payloads differ");
  }

  const headResponse = await fetchWithTimeout(sourceUrl, { method: "HEAD" });
  if (!headResponse.ok) {
    throw new Error(`HEAD source returned HTTP ${headResponse.status}`);
  }

  return source;
}

async function verifyAsset(url: string): Promise<void> {
  const response = await fetchWithTimeout(url, {
    method: "HEAD",
    headers: { "User-Agent": "SignAll-Source-Verifier/1.0" },
  });
  if (!response.ok) {
    throw new Error(`Asset returned HTTP ${response.status}: ${url}`);
  }
}

async function main(): Promise<void> {
  const options = parseCli();
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const source = await verifySource(options.sourceUrl);

      if (!options.skipAssets) {
        const assetUrls = new Set<string>([
          source.sourceicon,
          ...source.apps.flatMap((app) => [app.iconURL, app.downloadURL]),
        ]);
        await Promise.all([...assetUrls].map(verifyAsset));
      }

      console.log(
        `Public source verified: ${source.apps.length} app version(s) at ${source.sourceURL}`,
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt < options.attempts) {
        console.error(
          `Verification attempt ${attempt}/${options.attempts} failed: ${error instanceof Error ? error.message : error}`,
        );
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
    }
  }

  throw lastError;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
