import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  downloadReleaseAsset,
  releaseDescription,
  selectIpaAsset,
  sha256FromDigest,
  upsertAppVersion,
  versionFromTag,
  type GitHubRelease,
} from "../scripts/sync-upstream-release.js";
import { appsMetadataSchema } from "../src/schema.js";

const digest =
  "adc704a5dbe41e80c3a11946d79cef9c16a9bfaee01834beeebe21a1672b32ae";
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

function releaseFixture(): GitHubRelease {
  return {
    tag_name: "v0.9.10",
    name: "v0.9.10",
    body: "修复若干问题。\r\n优化启动速度。",
    draft: false,
    prerelease: false,
    published_at: "2026-11-07T12:00:00Z",
    created_at: "2026-11-07T11:50:00Z",
    assets: [
      {
        name: "zhihu-minus-minus-v0.9.10.apk",
        size: 100,
        digest: null,
        browser_download_url: "https://example.com/app.apk",
      },
      {
        name: "zhihu-minus-minus-v0.9.10-unsigned.ipa",
        size: 200,
        digest: `sha256:${digest}`,
        browser_download_url: "https://example.com/app.ipa",
      },
    ],
  };
}

describe("upstream release parsing", () => {
  it("normalizes version tags and prefers the unsigned IPA", () => {
    const release = releaseFixture();
    expect(versionFromTag(release.tag_name)).toBe("0.9.10");
    expect(selectIpaAsset(release)?.name).toBe(
      "zhihu-minus-minus-v0.9.10-unsigned.ipa",
    );
    expect(sha256FromDigest(`sha256:${digest.toUpperCase()}`)).toBe(digest);
  });

  it("normalizes release notes", () => {
    expect(releaseDescription(releaseFixture())).toBe(
      "修复若干问题。\n优化启动速度。",
    );
  });

  it("prepends and replaces version metadata", async () => {
    const metadata = appsMetadataSchema.parse(
      JSON.parse(
        await readFile(join(process.cwd(), "data", "apps.json"), "utf8"),
      ),
    );
    const nextEntry = {
      version: "0.9.10",
      versionDate: "2026-11-07T12:00:00Z",
      versionDescription: "新版本",
      file: {
        key: "apps/zhihu-minus-minus/0.9.10/zhihu-minus-minus-v0.9.10-unsigned.ipa",
        size: 200,
        sha256: digest,
      },
    };

    const added = upsertAppVersion(metadata, "zhihu-minus-minus", nextEntry);
    expect(added.apps[0]?.versions.map((entry) => entry.version)).toEqual([
      "0.9.10",
      "0.9.9",
    ]);

    const replaced = upsertAppVersion(added, "zhihu-minus-minus", {
      ...nextEntry,
      versionDescription: "修订说明",
    });
    expect(replaced.apps[0]?.versions).toHaveLength(2);
    expect(replaced.apps[0]?.versions[0]?.versionDescription).toBe("修订说明");
  });
});

describe("upstream IPA download", () => {
  it("streams an asset and computes its SHA-256", async () => {
    const body = Buffer.from("fake ipa content");
    const expectedHash = createHash("sha256").update(body).digest("hex");
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": body.length,
      });
      response.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Test server did not expose a port");
      }

      const tempRoot = await mkdtemp(join(tmpdir(), "signall-release-test-"));
      tempDirectories.push(tempRoot);
      const outputPath = join(tempRoot, "test.ipa");
      const sha256 = await downloadReleaseAsset(
        {
          name: "test.ipa",
          size: body.length,
          digest: `sha256:${expectedHash}`,
          browser_download_url: `http://127.0.0.1:${address.port}/test.ipa`,
        },
        outputPath,
      );

      expect(await readFile(outputPath)).toEqual(body);
      expect(sha256).toBe(expectedHash);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
