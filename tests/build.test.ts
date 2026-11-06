import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSite,
  createSourcePayload,
  joinPublicUrl,
  normalizeBaseUrl,
} from "../src/build.js";
import { loadMetadata } from "../src/metadata.js";
import {
  signAllSourceSchema,
  upstreamsMetadataSchema,
} from "../src/schema.js";
import { upsertTrackedVersion } from "../scripts/sync-upstream-release.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("SignAll source generation", () => {
  it("creates the observed SignAll field shape", async () => {
    const metadata = await loadMetadata();
    const payload = createSourcePayload(
      metadata,
      "https://source.example.com",
      "https://ipa.example.com",
    );

    expect(payload.sourceURL).toBe("https://source.example.com/appstore");
    expect(payload.sourceicon).toBe(
      "https://source.example.com/icons/source.png",
    );
    expect(payload.apps.length).toBeGreaterThanOrEqual(1);
    const zhihu = payload.apps.find(
      (app) => app.name === "知乎--" && app.version === "0.9.9",
    );
    expect(zhihu).toBeDefined();
    expect(zhihu).toMatchObject({
      name: "知乎--",
      type: "1",
      version: "0.9.9",
      lock: "0",
      isLanZouCloud: "0",
      iconURL: "https://source.example.com/icons/zhihu-minus-minus.png",
      tintColor: "1D9BF0",
      size: "14830602",
    });
    expect(zhihu?.downloadURL).toBe(
      "https://ipa.example.com/apps/zhihu-minus-minus/0.9.9/zhihu-minus-minus-v0.9.9-unsigned.ipa",
    );
  });

  it("writes an extensionless appstore endpoint and a worker", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "signall-build-"));
    tempDirectories.push(tempRoot);
    const distDir = join(tempRoot, "dist");
    const payload = await buildSite({
      rootDir: process.cwd(),
      distDir,
      publicBaseUrl: "https://source.example.com/",
      r2PublicBaseUrl: "https://ipa.example.com/",
    });

    const extensionless = await readFile(join(distDir, "appstore"), "utf8");
    const withExtension = await readFile(join(distDir, "appstore.json"), "utf8");
    expect(extensionless).toBe(withExtension);
    expect(signAllSourceSchema.parse(JSON.parse(extensionless))).toEqual(payload);
    expect((await stat(join(distDir, "_worker.js"))).isFile()).toBe(true);
    expect((await stat(join(distDir, "icons", "source.png"))).isFile()).toBe(
      true,
    );
  });

  it("keeps established app assertions valid after adding another app", async () => {
    const metadata = await loadMetadata();
    const upstreams = upstreamsMetadataSchema.parse(
      JSON.parse(
        await readFile(join(process.cwd(), "data", "upstreams.json"), "utf8"),
      ),
    ).upstreams;
    const jhentai = upstreams.find((upstream) => upstream.appId === "jhentai");
    if (!jhentai) {
      throw new Error("JHenTai upstream fixture is missing");
    }

    const expanded = upsertTrackedVersion(metadata, jhentai, {
      version: "8.0.18",
      versionDate: "2026-10-23T15:40:51Z",
      versionDescription: "测试版本",
      file: {
        key: "apps/jhentai/8.0.18/JHenTai_8.0.18+344.ipa",
        size: 13_027_008,
        sha256:
          "9da792f811e7a201adc96d281b5610915c1c9e28adc47d13a9bfef46cc4cc181",
      },
    });
    const payload = createSourcePayload(
      { ...metadata, apps: expanded.apps },
      "https://source.example.com",
      "https://ipa.example.com",
    );

    expect(
      payload.apps.find(
        (app) => app.name === "知乎--" && app.version === "0.9.9",
      ),
    ).toBeDefined();
    expect(
      payload.apps.find(
        (app) => app.name === "JHenTai" && app.version === "8.0.18",
      ),
    ).toMatchObject({
      type: "1",
      iconURL: "https://source.example.com/icons/jhentai.png",
      size: "13027008",
    });
  });
});

describe("URL handling", () => {
  it("normalizes origins and encodes R2 key segments", () => {
    expect(normalizeBaseUrl("https://example.com/", "base")).toBe(
      "https://example.com",
    );
    expect(
      joinPublicUrl(
        "https://ipa.example.com",
        "apps/demo/1.0+preview/demo 1.ipa",
      ),
    ).toBe(
      "https://ipa.example.com/apps/demo/1.0%2Bpreview/demo%201.ipa",
    );
  });

  it("rejects base URLs with query parameters", () => {
    expect(() =>
      normalizeBaseUrl("https://example.com/?preview=1", "base"),
    ).toThrow("must not include query parameters");
  });
});
