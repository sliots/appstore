import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadMetadata } from "../src/metadata.js";

function findWrangler(rootDir: string): string {
  return join(rootDir, "node_modules", "wrangler", "bin", "wrangler.js");
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      file: { type: "string" },
      key: { type: "string" },
      bucket: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });

  if (!values.file || !values.key) {
    throw new Error(
      "Usage: npm run ipa:upload -- --file <path-to.ipa> --key <apps/app-id/version/file.ipa> [--bucket name] [--dry-run]",
    );
  }

  const rootDir = process.cwd();
  const filePath = resolve(values.file);
  const key = values.key;
  if (!existsSync(filePath)) {
    throw new Error(`IPA does not exist: ${filePath}`);
  }
  if (!filePath.toLowerCase().endsWith(".ipa")) {
    throw new Error("The input file must have an .ipa extension");
  }

  const metadata = await loadMetadata(rootDir);
  const configuredFile = metadata.apps
    .flatMap((app) => app.versions)
    .map((version) => version.file)
    .find((candidate) => candidate.key === key);
  if (!configuredFile) {
    throw new Error(
      `Key '${key}' is not declared in data/apps.json. Add the version metadata first.`,
    );
  }

  const size = statSync(filePath).size;
  const sha256 = await sha256File(filePath);
  if (size !== configuredFile.size) {
    throw new Error(
      `Size mismatch for ${key}: file is ${size}, metadata says ${configuredFile.size}`,
    );
  }
  if (sha256 !== configuredFile.sha256) {
    throw new Error(
      `SHA-256 mismatch for ${key}: file is ${sha256}, metadata says ${configuredFile.sha256}`,
    );
  }

  const bucket = values.bucket ?? process.env.R2_BUCKET;
  if (!bucket) {
    throw new Error("Set R2_BUCKET or pass --bucket");
  }

  if (values["dry-run"]) {
    console.log(`Dry run passed for ${bucket}/${key} (${size} bytes, ${sha256})`);
    return;
  }

  const wrangler = findWrangler(rootDir);
  if (!existsSync(wrangler)) {
    throw new Error("Wrangler is not installed. Run npm install first.");
  }

  const result = spawnSync(
    process.execPath,
    [
      wrangler,
      "r2",
      "object",
      "put",
      `${bucket}/${key}`,
      "--file",
      filePath,
      "--content-type",
      "application/octet-stream",
      "--remote",
    ],
    {
      cwd: rootDir,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    },
  );

  if (result.status !== 0) {
    throw new Error(`Wrangler upload failed with exit code ${result.status ?? "unknown"}`);
  }

  console.log(`Uploaded ${bucket}/${key} (${size} bytes, ${sha256})`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
