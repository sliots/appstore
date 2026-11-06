import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadMetadata, type MetadataBundle } from "./metadata.js";
import {
  signAllSourceSchema,
  type AppMetadata,
  type SignAllSource,
} from "./schema.js";

export interface BuildOptions {
  rootDir: string;
  distDir: string;
  publicBaseUrl: string;
  r2PublicBaseUrl: string;
}

export function normalizeBaseUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${name} must use http or https`);
  }
  if (url.search || url.hash) {
    throw new Error(`${name} must not include query parameters or a fragment`);
  }

  return url.toString().replace(/\/+$/u, "");
}

export function joinPublicUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/u, "");
  const encodedPath = path
    .replace(/^\/+/u, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${normalizedBase}/${encodedPath}`;
}

export function expandPublicTemplate(
  value: string,
  publicBaseUrl: string,
  label: string,
): string {
  if (value === "") {
    return "";
  }

  const expanded = value.replaceAll("${PUBLIC_BASE_URL}", publicBaseUrl);
  try {
    return new URL(expanded).toString();
  } catch {
    return joinPublicUrl(publicBaseUrl, expanded);
  }
}

function protocolType(type: AppMetadata["type"]): 0 | "1" | "2" | "3" | "4" | "5" {
  return type === 0 ? 0 : (String(type) as "1" | "2" | "3" | "4" | "5");
}

export function createSourcePayload(
  metadata: MetadataBundle,
  publicBaseUrl: string,
  r2PublicBaseUrl: string,
): SignAllSource {
  const apps = metadata.apps.flatMap((app) =>
    app.versions.map((entry) => ({
      name: app.name,
      type: protocolType(app.type),
      version: entry.version,
      versionDate: entry.versionDate,
      versionDescription: entry.versionDescription,
      lock: "0" as const,
      downloadURL: joinPublicUrl(r2PublicBaseUrl, entry.file.key),
      isLanZouCloud: "0" as const,
      iconURL: joinPublicUrl(publicBaseUrl, app.icon),
      tintColor: app.tintColor.toUpperCase(),
      size: String(entry.file.size),
    })),
  );

  const source = {
    name: metadata.source.name,
    message: metadata.source.message,
    identifier: metadata.source.identifier,
    sourceURL: expandPublicTemplate(
      metadata.source.sourceURL,
      publicBaseUrl,
      "sourceURL",
    ),
    sourceicon: metadata.source.sourceicon.startsWith("http")
      ? metadata.source.sourceicon
      : joinPublicUrl(publicBaseUrl, metadata.source.sourceicon),
    payURL: expandPublicTemplate(
      metadata.source.payURL,
      publicBaseUrl,
      "payURL",
    ),
    unlockURL: expandPublicTemplate(
      metadata.source.unlockURL,
      publicBaseUrl,
      "unlockURL",
    ),
    apps,
  };

  return signAllSourceSchema.parse(source);
}

export async function buildSite(options: BuildOptions): Promise<SignAllSource> {
  const rootDir = resolve(options.rootDir);
  const distDir = resolve(options.distDir);

  if (distDir === rootDir || basename(distDir) !== "dist") {
    throw new Error(`Refusing to replace unsafe output directory: ${distDir}`);
  }

  const publicBaseUrl = normalizeBaseUrl(
    options.publicBaseUrl,
    "PUBLIC_BASE_URL",
  );
  const r2PublicBaseUrl = normalizeBaseUrl(
    options.r2PublicBaseUrl,
    "R2_PUBLIC_BASE_URL",
  );
  const metadata = await loadMetadata(rootDir);
  const payload = createSourcePayload(metadata, publicBaseUrl, r2PublicBaseUrl);
  const json = `${JSON.stringify(payload, null, 2)}\n`;

  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  await cp(join(rootDir, "public"), distDir, { recursive: true });
  await writeFile(join(distDir, "appstore"), json, "utf8");
  await writeFile(join(distDir, "appstore.json"), json, "utf8");

  return payload;
}

async function runCli(): Promise<void> {
  const rootDir = process.cwd();
  const envPath = join(rootDir, ".env");
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }

  const publicBaseUrl = process.env.PUBLIC_BASE_URL?.trim();
  const r2PublicBaseUrl = process.env.R2_PUBLIC_BASE_URL?.trim();
  if (!publicBaseUrl || !r2PublicBaseUrl) {
    throw new Error(
      "PUBLIC_BASE_URL and R2_PUBLIC_BASE_URL are required. Copy .env.example to .env and set both values.",
    );
  }

  const payload = await buildSite({
    rootDir,
    distDir: join(rootDir, "dist"),
    publicBaseUrl,
    r2PublicBaseUrl,
  });

  console.log(
    `Built ${payload.apps.length} app version(s) for ${payload.sourceURL}`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
