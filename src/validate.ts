import { loadMetadata } from "./metadata.js";

async function run(): Promise<void> {
  const metadata = await loadMetadata();
  const versions = metadata.apps.reduce(
    (total, app) => total + app.versions.length,
    0,
  );
  console.log(
    `Metadata is valid: ${metadata.apps.length} app(s), ${versions} version(s), identifier '${metadata.source.identifier}'.`,
  );
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
