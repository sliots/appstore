import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ZodError, type ZodType } from "zod";
import {
  appsMetadataSchema,
  sourceMetadataSchema,
  upstreamsMetadataSchema,
  type AppsMetadata,
  type SourceMetadata,
  type UpstreamsMetadata,
} from "./schema.js";

export interface MetadataBundle {
  source: SourceMetadata;
  apps: AppsMetadata["apps"];
  upstreams: UpstreamsMetadata["upstreams"];
}

function parseJson<T>(schema: ZodType<T>, raw: string, path: string): T {
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${path}: invalid JSON\n${(error as Error).message}`);
  }

  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.issues
        .map((issue) => {
          const field = issue.path.length > 0 ? issue.path.join(".") : "(root)";
          return `  - ${field}: ${issue.message}`;
        })
        .join("\n");
      throw new Error(`${path}: metadata validation failed\n${details}`);
    }
    throw error;
  }
}

export async function loadMetadata(rootDir = process.cwd()): Promise<MetadataBundle> {
  const sourcePath = join(rootDir, "data", "source.json");
  const appsPath = join(rootDir, "data", "apps.json");
  const upstreamsPath = join(rootDir, "data", "upstreams.json");

  const [sourceRaw, appsRaw, upstreamsRaw] = await Promise.all([
    readFile(sourcePath, "utf8"),
    readFile(appsPath, "utf8"),
    readFile(upstreamsPath, "utf8"),
  ]);

  const source = parseJson(sourceMetadataSchema, sourceRaw, sourcePath);
  const apps = parseJson(appsMetadataSchema, appsRaw, appsPath).apps;
  const upstreams = parseJson(
    upstreamsMetadataSchema,
    upstreamsRaw,
    upstreamsPath,
  ).upstreams;

  if (source.sourceicon.startsWith("icons/")) {
    await assertFileExists(join(rootDir, "public", source.sourceicon), "source icon");
  }

  for (const app of apps) {
    await assertFileExists(
      join(rootDir, "public", app.icon),
      `${app.id} icon`,
    );
  }

  for (const upstream of upstreams) {
    const existingApp = apps.find((app) => app.id === upstream.appId);
    if (!existingApp && !upstream.createApp) {
      throw new Error(
        `${upstreamsPath}: upstream '${upstream.repository}' references missing app '${upstream.appId}' without createApp defaults`,
      );
    }
    if (upstream.createApp) {
      await assertFileExists(
        join(rootDir, "public", upstream.createApp.icon),
        `${upstream.appId} default icon`,
      );
    }
  }

  return { source, apps, upstreams };
}

async function assertFileExists(path: string, label: string): Promise<void> {
  try {
    await readFile(path);
  } catch {
    throw new Error(`${label} does not exist: ${path}`);
  }
}
