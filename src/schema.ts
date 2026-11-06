import { z } from "zod";

const absoluteHttpUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => /^https?:\/\//u.test(value),
    "must use HTTP or HTTPS",
  );

const publicUrlTemplateSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) =>
      value === "" ||
      value.includes("${PUBLIC_BASE_URL}") ||
      /^https?:\/\/[^\s]+$/u.test(value),
    "must be an HTTP(S) URL or use ${PUBLIC_BASE_URL}",
  );

const relativeIconSchema = z
  .string()
  .regex(
    /^icons\/[A-Za-z0-9][A-Za-z0-9._/-]*\.(?:png|jpe?g|webp|svg)$/u,
    "must be a file under icons/ with a supported image extension",
  )
  .refine((value) => !value.includes(".."), "must not contain '..'");

export const sourceMetadataSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    identifier: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(
        /^[A-Za-z0-9][A-Za-z0-9._-]*$/u,
        "must be a stable ASCII identifier",
      ),
    message: z.string().max(10_000),
    sourceURL: publicUrlTemplateSchema,
    sourceicon: z.union([relativeIconSchema, absoluteHttpUrlSchema]),
    payURL: publicUrlTemplateSchema.or(z.literal("")),
    unlockURL: publicUrlTemplateSchema.or(z.literal("")),
  })
  .strict();

export const appTypeSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

const versionStringSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[0-9][A-Za-z0-9._+-]*$/u,
    "must start with a digit and contain no slashes or spaces",
  );

const ipaFileSchema = z
  .object({
    key: z
      .string()
      .regex(
        /^apps\/[a-z0-9][a-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._+-]*\/[^/]+\.ipa$/u,
        "must match apps/<app-id>/<version>/<file>.ipa",
      ),
    size: z.number().int().positive(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u, "must be a lowercase SHA-256 hex digest"),
  })
  .strict();

export const appVersionSchema = z
  .object({
    version: versionStringSchema,
    versionDate: z.string().datetime({ offset: true }),
    versionDescription: z.string().trim().min(1).max(50_000),
    file: ipaFileSchema,
  })
  .strict();

const appIdSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]*$/u,
    "must use lowercase letters, digits, and hyphens",
  );

const appDefaultsSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    bundleIdentifier: z
      .string()
      .regex(
        /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u,
        "must be a reverse-DNS bundle identifier",
      ),
    icon: relativeIconSchema,
    type: appTypeSchema,
    tintColor: z
      .string()
      .regex(/^[0-9A-Fa-f]{6}$/u, "must be a six-digit hex color without #"),
  })
  .strict();

const appSchema = z
  .object({
    id: appIdSchema,
    ...appDefaultsSchema.shape,
    versions: z.array(appVersionSchema).min(1),
  })
  .strict()
  .superRefine((app, context) => {
    const seenVersions = new Set<string>();

    app.versions.forEach((entry, index) => {
      if (seenVersions.has(entry.version)) {
        context.addIssue({
          code: "custom",
          path: ["versions", index, "version"],
          message: `duplicate version '${entry.version}'`,
        });
      }
      seenVersions.add(entry.version);

      const expectedPrefix = `apps/${app.id}/${entry.version}/`;
      if (!entry.file.key.startsWith(expectedPrefix)) {
        context.addIssue({
          code: "custom",
          path: ["versions", index, "file", "key"],
          message: `must start with ${expectedPrefix}`,
        });
      }
    });
  });

export const appsMetadataSchema = z
  .object({
    apps: z.array(appSchema).min(1),
  })
  .strict()
  .superRefine(({ apps }, context) => {
    const seenIds = new Set<string>();
    const seenBundleIdentifiers = new Set<string>();

    apps.forEach((app, index) => {
      if (seenIds.has(app.id)) {
        context.addIssue({
          code: "custom",
          path: ["apps", index, "id"],
          message: `duplicate app id '${app.id}'`,
        });
      }
      seenIds.add(app.id);

      const bundleIdentifier = app.bundleIdentifier.toLowerCase();
      if (seenBundleIdentifiers.has(bundleIdentifier)) {
        context.addIssue({
          code: "custom",
          path: ["apps", index, "bundleIdentifier"],
          message: `duplicate bundle identifier '${app.bundleIdentifier}'`,
        });
      }
      seenBundleIdentifiers.add(bundleIdentifier);
    });
  });

export const upstreamsMetadataSchema = z
  .object({
    upstreams: z
      .array(
        z
          .object({
            repository: z
              .string()
              .regex(
                /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
                "must be a GitHub repository in owner/name form",
              ),
            appId: appIdSchema,
            createApp: appDefaultsSchema.optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine(({ upstreams }, context) => {
    const repositories = new Set<string>();
    const appIds = new Set<string>();

    upstreams.forEach((upstream, index) => {
      const repository = upstream.repository.toLowerCase();
      if (repositories.has(repository)) {
        context.addIssue({
          code: "custom",
          path: ["upstreams", index, "repository"],
          message: `duplicate repository '${upstream.repository}'`,
        });
      }
      repositories.add(repository);

      if (appIds.has(upstream.appId)) {
        context.addIssue({
          code: "custom",
          path: ["upstreams", index, "appId"],
          message: `duplicate app id '${upstream.appId}'`,
        });
      }
      appIds.add(upstream.appId);
    });
  });

export const signAllAppSchema = z.object({
  name: z.string(),
  type: z.union([z.literal(0), z.enum(["1", "2", "3", "4", "5"])]),
  version: z.string(),
  versionDate: z.string().datetime({ offset: true }),
  versionDescription: z.string(),
  lock: z.literal("0"),
  downloadURL: z.string().url(),
  isLanZouCloud: z.literal("0"),
  iconURL: z.string().url(),
  tintColor: z.string().regex(/^[0-9A-Fa-f]{6}$/u),
  size: z.string().regex(/^\d+$/u),
});

export const signAllSourceSchema = z.object({
  name: z.string(),
  message: z.string(),
  identifier: z.string(),
  sourceURL: absoluteHttpUrlSchema,
  sourceicon: absoluteHttpUrlSchema,
  payURL: z.union([z.literal(""), absoluteHttpUrlSchema]),
  unlockURL: z.union([z.literal(""), absoluteHttpUrlSchema]),
  apps: z.array(signAllAppSchema).min(1),
});

export type SourceMetadata = z.infer<typeof sourceMetadataSchema>;
export type AppDefaults = z.infer<typeof appDefaultsSchema>;
export type AppMetadata = z.infer<typeof appSchema>;
export type AppsMetadata = z.infer<typeof appsMetadataSchema>;
export type AppVersionMetadata = z.infer<typeof appVersionSchema>;
export type UpstreamsMetadata = z.infer<typeof upstreamsMetadataSchema>;
export type SignAllSource = z.infer<typeof signAllSourceSchema>;
