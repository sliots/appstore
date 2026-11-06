import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  appVersionSchema,
  appsMetadataSchema,
  upstreamsMetadataSchema,
  type AppsMetadata,
  type UpstreamsMetadata,
} from "../src/schema.js";

export interface GitHubReleaseAsset {
  name: string;
  size: number;
  digest?: string | null;
  browser_download_url: string;
  content_type?: string;
}

export interface GitHubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  created_at: string;
  assets: GitHubReleaseAsset[];
}

export interface SyncUpdate {
  repository: string;
  appId: string;
  version: string;
  reason: string;
  file: string;
  key: string;
}

export interface SyncManifest {
  checkedAt: string;
  updates: SyncUpdate[];
}

type Upstream = UpstreamsMetadata["upstreams"][number];
type VersionEntry = AppsMetadata["apps"][number]["versions"][number];

interface CliOptions {
  trackersPath: string;
  outputDir: string;
  manifestOutput: string;
  githubOutput?: string | undefined;
}

export function versionFromTag(tagName: string): string {
  return tagName.trim().replace(/^v/iu, "");
}

export function selectIpaAsset(
  release: GitHubRelease,
): GitHubReleaseAsset | undefined {
  const ipaAssets = release.assets.filter((asset) =>
    asset.name.toLowerCase().endsWith(".ipa"),
  );
  return (
    ipaAssets.find((asset) => /unsigned/iu.test(asset.name)) ?? ipaAssets[0]
  );
}

export function sha256FromDigest(
  digest: string | null | undefined,
): string | undefined {
  return digest?.match(/^sha256:([a-f0-9]{64})$/iu)?.[1]?.toLowerCase();
}

export function releaseDescription(release: GitHubRelease): string {
  const description = (release.body ?? "").trim().replaceAll("\r\n", "\n");
  const fallback = release.name?.trim() || `Release ${release.tag_name}`;
  return (description || fallback).slice(0, 50_000);
}

export function upsertAppVersion(
  metadata: AppsMetadata,
  appId: string,
  versionEntry: VersionEntry,
): AppsMetadata {
  if (!metadata.apps.some((app) => app.id === appId)) {
    throw new Error(`App '${appId}' does not exist in data/apps.json`);
  }

  return appsMetadataSchema.parse({
    apps: metadata.apps.map((app) => {
      if (app.id !== appId) {
        return app;
      }

      const existingIndex = app.versions.findIndex(
        (version) => version.version === versionEntry.version,
      );
      const versions =
        existingIndex < 0
          ? [versionEntry, ...app.versions]
          : app.versions.map((version, index) =>
              index === existingIndex ? versionEntry : version,
            );

      return { ...app, versions };
    }),
  });
}

export function upsertTrackedVersion(
  metadata: AppsMetadata,
  upstream: Upstream,
  versionEntry: VersionEntry,
): AppsMetadata {
  if (metadata.apps.some((app) => app.id === upstream.appId)) {
    return upsertAppVersion(metadata, upstream.appId, versionEntry);
  }
  if (!upstream.createApp) {
    throw new Error(
      `App '${upstream.appId}' does not exist and upstream '${upstream.repository}' has no createApp defaults`,
    );
  }

  return appsMetadataSchema.parse({
    apps: [
      ...metadata.apps,
      {
        id: upstream.appId,
        ...upstream.createApp,
        versions: [versionEntry],
      },
    ],
  });
}

function parseCli(): CliOptions {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      trackers: { type: "string", default: "data/upstreams.json" },
      "output-dir": { type: "string", default: ".release-sync" },
      "manifest-output": {
        type: "string",
        default: ".release-sync/manifest.json",
      },
      "github-output": { type: "string" },
    },
  });

  return {
    trackersPath: values.trackers,
    outputDir: values["output-dir"],
    manifestOutput: values["manifest-output"],
    githubOutput: values["github-output"],
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "User-Agent": "SignAll-App-Source-Release-Sync",
    "X-GitHub-Api-Version": "2022-11-28",
  });
  if (process.env.GITHUB_TOKEN) {
    headers.set("Authorization", `Bearer ${process.env.GITHUB_TOKEN}`);
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(
      `GitHub API returned HTTP ${response.status} for ${url}: ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

function safeFileName(name: string): string {
  return name
    .replace(/[^A-Za-z0-9._+-]/gu, "-")
    .replace(/-+/gu, "-");
}

export async function downloadReleaseAsset(
  asset: GitHubReleaseAsset,
  outputPath: string,
): Promise<string> {
  const headers = new Headers({
    Accept: "application/octet-stream",
    "User-Agent": "SignAll-App-Source-Release-Sync",
  });
  if (process.env.GITHUB_TOKEN) {
    headers.set("Authorization", `Bearer ${process.env.GITHUB_TOKEN}`);
  }

  const response = await fetch(asset.browser_download_url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(
      `IPA download returned HTTP ${response.status}: ${asset.browser_download_url}`,
    );
  }

  const partialPath = `${outputPath}.part`;
  const hash = createHash("sha256");
  const hashingStream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body as never),
      hashingStream,
      createWriteStream(partialPath),
    );
    await rename(partialPath, outputPath);
  } catch (error) {
    await rm(partialPath, { force: true });
    throw error;
  }

  return hash.digest("hex");
}

async function writeOutputs(
  options: CliOptions,
  manifest: SyncManifest,
): Promise<void> {
  await mkdir(dirname(resolve(options.manifestOutput)), { recursive: true });
  await writeFile(
    resolve(options.manifestOutput),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  if (!options.githubOutput) {
    return;
  }

  const versions = manifest.updates
    .map((update) => update.version)
    .filter((version, index, all) => all.indexOf(version) === index)
    .join(",");
  const lines = [
    `updated=${manifest.updates.length > 0}`,
    `manifest=${resolve(options.manifestOutput)}`,
    `versions=${versions}`,
  ];
  await appendFile(options.githubOutput, `${lines.join("\n")}\n`, "utf8");
}

async function syncRelease(
  options: CliOptions,
  metadata: AppsMetadata,
  upstream: Upstream,
): Promise<SyncUpdate | undefined> {
  const release = await fetchJson<GitHubRelease>(
    `https://api.github.com/repos/${upstream.repository}/releases/latest`,
  );
  if (release.draft || release.prerelease) {
    throw new Error(
      `${upstream.repository}: latest release is a draft or prerelease`,
    );
  }

  const version = versionFromTag(release.tag_name);
  const asset = selectIpaAsset(release);
  if (!asset) {
    throw new Error(
      `${upstream.repository}: release ${release.tag_name} does not contain an IPA asset`,
    );
  }

  const app = metadata.apps.find((candidate) => candidate.id === upstream.appId);
  const existingVersion = app?.versions.find(
    (candidate) => candidate.version === version,
  );
  const remoteDigest = sha256FromDigest(asset.digest);
  if (
    existingVersion &&
    existingVersion.file.size === asset.size &&
    (!remoteDigest || existingVersion.file.sha256 === remoteDigest)
  ) {
    console.log(
      `${upstream.repository}: version ${version} is already up to date`,
    );
    return undefined;
  }

  const fileName = safeFileName(asset.name);
  const key = `apps/${upstream.appId}/${version}/${fileName}`;
  const outputDir = resolve(options.outputDir);
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${upstream.appId}-${basename(fileName)}`);
  const sha256 = await downloadReleaseAsset(asset, outputPath);
  const downloadedSize = (await stat(outputPath)).size;

  if (downloadedSize !== asset.size) {
    throw new Error(
      `${upstream.repository}: downloaded IPA size mismatch, expected ${asset.size}, got ${downloadedSize}`,
    );
  }
  if (remoteDigest && remoteDigest !== sha256) {
    throw new Error(
      `${upstream.repository}: downloaded IPA digest mismatch, GitHub says ${remoteDigest}, downloaded ${sha256}`,
    );
  }

  const versionEntry = appVersionSchema.parse({
    version,
    versionDate: release.published_at ?? release.created_at,
    versionDescription: releaseDescription(release),
    file: {
      key,
      size: downloadedSize,
      sha256,
    },
  });
  const existingApp = metadata.apps.some(
    (candidate) => candidate.id === upstream.appId,
  );
  const nextMetadata = upsertTrackedVersion(
    metadata,
    upstream,
    versionEntry,
  );
  metadata.apps.splice(0, metadata.apps.length, ...nextMetadata.apps);

  const reason = !existingApp
    ? "new app"
    : existingVersion
      ? "release asset changed"
      : "new release";
  console.log(
    `${upstream.repository}: prepared ${version}, ${sha256}, R2 key ${key}`,
  );
  return {
    repository: upstream.repository,
    appId: upstream.appId,
    version,
    reason,
    file: outputPath,
    key,
  };
}

async function main(): Promise<void> {
  const options = parseCli();
  const metadataPath = join(process.cwd(), "data", "apps.json");
  const metadata = appsMetadataSchema.parse(
    JSON.parse(await readFile(metadataPath, "utf8")),
  );
  const trackers = upstreamsMetadataSchema.parse(
    JSON.parse(await readFile(resolve(options.trackersPath), "utf8")),
  );

  const updates: SyncUpdate[] = [];
  for (const upstream of trackers.upstreams) {
    const update = await syncRelease(options, metadata, upstream);
    if (update) {
      updates.push(update);
    }
  }

  if (updates.length > 0) {
    await writeFile(
      metadataPath,
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    );
  }

  const manifest: SyncManifest = {
    checkedAt: new Date().toISOString(),
    updates,
  };
  await writeOutputs(options, manifest);

  if (updates.length === 0) {
    console.log("No upstream updates found.");
  } else {
    console.log(
      `Prepared ${updates.length} update(s): ${updates.map((update) => `${update.appId}@${update.version}`).join(", ")}`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
