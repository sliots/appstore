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
import { basename, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  appVersionSchema,
  appsMetadataSchema,
  type AppsMetadata,
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

export interface SyncResult {
  updated: boolean;
  version: string;
  reason: string;
  file?: string;
  key?: string;
}

interface CliOptions {
  upstreamRepository: string;
  appId: string;
  outputDir: string;
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
  versionEntry: AppsMetadata["apps"][number]["versions"][number],
): AppsMetadata {
  const appIndex = metadata.apps.findIndex((app) => app.id === appId);
  if (appIndex < 0) {
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

function parseCli(): CliOptions {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "upstream-repository": {
        type: "string",
        default:
          process.env.UPSTREAM_REPOSITORY ?? "huamurui/zhihu-minus-minus",
      },
      "app-id": { type: "string", default: "zhihu-minus-minus" },
      "output-dir": { type: "string", default: ".release-sync" },
      "github-output": { type: "string" },
    },
  });

  return {
    upstreamRepository: values["upstream-repository"],
    appId: values["app-id"],
    outputDir: values["output-dir"],
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

async function writeGitHubOutput(
  path: string | undefined,
  result: SyncResult,
): Promise<void> {
  if (!path) {
    return;
  }

  const lines = [
    `updated=${result.updated}`,
    `version=${result.version}`,
    `reason=${result.reason}`,
    `file=${result.file ?? ""}`,
    `key=${result.key ?? ""}`,
  ];
  await appendFile(path, `${lines.join("\n")}\n`, "utf8");
}

async function syncRelease(options: CliOptions): Promise<SyncResult> {
  const release = await fetchJson<GitHubRelease>(
    `https://api.github.com/repos/${options.upstreamRepository}/releases/latest`,
  );
  if (release.draft || release.prerelease) {
    throw new Error("GitHub latest release unexpectedly returned a draft or prerelease");
  }

  const version = versionFromTag(release.tag_name);
  const asset = selectIpaAsset(release);
  if (!asset) {
    throw new Error(`Release ${release.tag_name} does not contain an IPA asset`);
  }

  const metadataPath = join(process.cwd(), "data", "apps.json");
  const metadata = appsMetadataSchema.parse(
    JSON.parse(await readFile(metadataPath, "utf8")),
  );
  const app = metadata.apps.find((candidate) => candidate.id === options.appId);
  if (!app) {
    throw new Error(`App '${options.appId}' does not exist in data/apps.json`);
  }

  const existingVersion = app.versions.find(
    (candidate) => candidate.version === version,
  );
  const remoteDigest = sha256FromDigest(asset.digest);
  if (
    existingVersion &&
    existingVersion.file.size === asset.size &&
    (!remoteDigest || existingVersion.file.sha256 === remoteDigest)
  ) {
    return {
      updated: false,
      version,
      reason: `version ${version} is already up to date`,
    };
  }

  const fileName = safeFileName(asset.name);
  const key = `apps/${app.id}/${version}/${fileName}`;
  const outputDir = resolve(options.outputDir);
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, basename(fileName));
  const sha256 = await downloadReleaseAsset(asset, outputPath);
  const downloadedSize = (await stat(outputPath)).size;

  if (downloadedSize !== asset.size) {
    throw new Error(
      `Downloaded IPA size mismatch: expected ${asset.size}, got ${downloadedSize}`,
    );
  }
  if (remoteDigest && remoteDigest !== sha256) {
    throw new Error(
      `Downloaded IPA digest mismatch: GitHub says ${remoteDigest}, downloaded ${sha256}`,
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
  const nextMetadata = upsertAppVersion(metadata, options.appId, versionEntry);
  await writeFile(
    metadataPath,
    `${JSON.stringify(nextMetadata, null, 2)}\n`,
    "utf8",
  );

  return {
    updated: true,
    version,
    reason: existingVersion ? "release asset changed" : "new release",
    file: outputPath,
    key,
  };
}

async function main(): Promise<void> {
  const options = parseCli();
  const result = await syncRelease(options);
  await writeGitHubOutput(options.githubOutput, result);

  if (result.updated) {
    console.log(
      `Release ${result.version} prepared at ${result.file} for R2 key ${result.key}`,
    );
  } else {
    console.log(`No update: ${result.reason}`);
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
