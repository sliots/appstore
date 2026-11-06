import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appsMetadataSchema } from "../src/schema.js";

describe("metadata schema", () => {
  it("requires R2 keys to match the app id and version", async () => {
    const raw = JSON.parse(
      await readFile(join(process.cwd(), "data", "apps.json"), "utf8"),
    );
    const zhihu = raw.apps.find(
      (app: { id: string }) => app.id === "zhihu-minus-minus",
    );
    zhihu.versions[0].file.key =
      "apps/other-app/0.9.9/zhihu-minus-minus.ipa";

    expect(() => appsMetadataSchema.parse(raw)).toThrow(
      "must start with apps/zhihu-minus-minus/0.9.9/",
    );
  });

  it("rejects duplicate versions for one app", async () => {
    const raw = JSON.parse(
      await readFile(join(process.cwd(), "data", "apps.json"), "utf8"),
    );
    const zhihu = raw.apps.find(
      (app: { id: string }) => app.id === "zhihu-minus-minus",
    );
    zhihu.versions.push(structuredClone(zhihu.versions[0]));

    expect(() => appsMetadataSchema.parse(raw)).toThrow("duplicate version");
  });

  it("rejects unsafe icon paths", async () => {
    const raw = JSON.parse(
      await readFile(join(process.cwd(), "data", "apps.json"), "utf8"),
    );
    const zhihu = raw.apps.find(
      (app: { id: string }) => app.id === "zhihu-minus-minus",
    );
    zhihu.icon = "icons/../secret.png";

    expect(() => appsMetadataSchema.parse(raw)).toThrow();
  });
});
