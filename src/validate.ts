import { loadMetadata } from "./metadata.js";

async function run(): Promise<void> {
  const metadata = await loadMetadata();
  const versions = metadata.apps.reduce(
    (total, app) => total + app.versions.length,
    0,
  );
  const pendingApps = metadata.upstreams.filter(
    (upstream) =>
      !metadata.apps.some((app) => app.id === upstream.appId),
  );
  console.log(
    `Metadata is valid: ${metadata.apps.length} app(s), ${versions} version(s), ${metadata.upstreams.length} upstream tracker(s), ${pendingApps.length} pending app(s), identifier '${metadata.source.identifier}'.`,
  );
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
