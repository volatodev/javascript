import { z } from "zod";

export const READ_SCOPES = [
  "projects:read",
  "errors:read",
  "releases:read",
] as const;

export type ReadScope = (typeof READ_SCOPES)[number];

export const runtimeSchema = z.enum([
  "client",
  "browser",
  "node",
  "python",
  "rsc",
  "server_action",
  "route_handler",
  "middleware",
]);

export const cursorSchema = z
  .string()
  .regex(/^\d+$/, "cursor must be a non-negative decimal offset")
  .transform((value) => Number.parseInt(value, 10))
  .pipe(z.number().int().min(0).max(100_000))
  .optional();

export function nextCursor(offset: number, returned: number, hasMore: boolean) {
  return hasMore ? String(offset + returned) : null;
}

export const listProjectsInputSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: cursorSchema,
});

export const getErrorContextInputSchema = z.object({
  id: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  environment: z.string().min(1).max(32).default("production"),
});

export const searchErrorGroupsInputSchema = z.object({
  status: z.enum(["unresolved", "resolved", "ignored", "all"]).default("unresolved"),
  release: z.string().min(1).max(200).optional(),
  baselineRelease: z.string().min(1).max(200).optional(),
  environment: z.string().min(1).max(32).default("production"),
  query: z.string().min(1).max(200).optional(),
  fingerprint: z.string().min(1).max(64).optional(),
  runtime: runtimeSchema.optional(),
  route: z.string().min(1).max(4096).optional(),
  firstSeenAfter: z.string().datetime({ offset: true }).optional(),
  firstSeenBefore: z.string().datetime({ offset: true }).optional(),
  lastSeenAfter: z.string().datetime({ offset: true }).optional(),
  lastSeenBefore: z.string().datetime({ offset: true }).optional(),
  minEvents: z.coerce.number().int().min(1).optional(),
  minUsers: z.coerce.number().int().min(1).optional(),
  sort: z.enum(["recent", "new", "users", "events", "growth"]).default("recent"),
  projectId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: cursorSchema,
});

export const getErrorSamplesInputSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  environment: z.string().min(1).max(32).default("production"),
  release: z.string().min(1).max(200).optional(),
  runtime: runtimeSchema.optional(),
  route: z.string().min(1).max(4096).optional(),
  strategy: z.enum(["all", "recent", "representative", "variations"]).default("all"),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

export const listReleasesInputSchema = z.object({
  projectId: z.string().uuid().optional(),
  environment: z.string().min(1).max(32).default("production"),
  runtime: runtimeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: cursorSchema,
});

export const compareReleasesInputSchema = listReleasesInputSchema.extend({
  head: z.string().min(1).max(200).optional(),
  base: z.string().min(1).max(200).optional(),
});

const dateString = z.string().datetime({ offset: true });

export const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  active: z.boolean(),
  createdAt: dateString,
  lastEventAt: dateString.nullable(),
});

export const errorGroupSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  projectName: z.string(),
  fingerprint: z.string(),
  message: z.string(),
  severity: z.enum(["error", "warning"]),
  status: z.enum(["unresolved", "resolved", "ignored"]),
  eventCount: z.number().int(),
  matchingEventCount: z.number().int(),
  affectedUserCount: z.number().int(),
  firstSeen: dateString,
  lastSeen: dateString,
  firstMatchedAt: dateString,
  lastMatchedAt: dateString,
  runtimes: z.array(z.string()),
  routes: z.array(z.string()),
  releases: z.array(z.string()),
  baselineEventCount: z.number().int(),
  growthDelta: z.number().int(),
  growthRatio: z.number().nullable(),
});

export const releaseSchema = z.object({
  release: z.string(),
  commitShas: z.array(z.string()),
  projectIds: z.array(z.string().uuid()),
  runtimes: z.array(z.string()),
  eventCount: z.number().int(),
  groupCount: z.number().int(),
  firstSeen: dateString,
  lastSeen: dateString,
});

export const listProjectsResultSchema = z.object({
  kind: z.literal("ok"),
  projects: z.array(projectSchema),
  nextCursor: z.string().nullable(),
});

export const searchErrorGroupsResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ok"),
    rows: z.array(errorGroupSchema),
    nextCursor: z.string().nullable(),
    query: z.record(z.string(), z.unknown()),
  }),
  z.object({
    kind: z.literal("release_unknown"),
    nextCursor: z.null(),
    query: z.record(z.string(), z.unknown()),
  }),
  z.object({
    kind: z.literal("no_match"),
    eventsForRelease: z.number().int(),
    nextCursor: z.null(),
    query: z.record(z.string(), z.unknown()),
  }),
]);

export const errorContextResultSchema = z
  .object({
    group: z.record(z.string(), z.unknown()),
    events: z.array(z.record(z.string(), z.unknown())).max(3),
    commitTransition: z.record(z.string(), z.unknown()).nullable(),
    resolvedFrame: z.record(z.string(), z.unknown()).nullable(),
    resolutionState: z.string().nullable(),
    history: z.array(z.record(z.string(), z.unknown())).max(10),
    affectedUsers: z.record(z.string(), z.unknown()).nullable(),
    similarResolved: z.array(z.record(z.string(), z.unknown())).max(3),
  })
  .nullable();

export const errorSamplesResultSchema = z.object({
  kind: z.literal("ok"),
  group: z.object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    message: z.string(),
    fingerprint: z.string(),
  }),
  samples: z.array(z.record(z.string(), z.unknown())).max(10),
  scan: z.object({
    candidatesConsidered: z.number().int(),
    candidateLimit: z.literal(200),
  }),
  query: z.record(z.string(), z.unknown()),
  privacy: z.string(),
});

export const listReleasesResultSchema = z.object({
  kind: z.literal("ok"),
  releases: z.array(releaseSchema),
  latest: releaseSchema.nullable(),
  previous: releaseSchema.nullable(),
  nextCursor: z.string().nullable(),
  query: z.record(z.string(), z.unknown()),
});

export const compareReleasesResultSchema = z
  .object({
    kind: z.literal("ok"),
    head: releaseSchema,
    base: releaseSchema,
    summary: z.record(z.string(), z.number().int()),
    changes: z.array(z.record(z.string(), z.unknown())),
    nextCursor: z.string().nullable(),
    query: z.record(z.string(), z.unknown()),
  })
  .passthrough()
  .or(z.object({ kind: z.literal("no_releases") }).passthrough())
  .or(z.object({ kind: z.literal("previous_release_unavailable") }).passthrough());

export type ListProjectsInput = z.input<typeof listProjectsInputSchema>;
export type GetErrorContextInput = z.input<typeof getErrorContextInputSchema>;
export type SearchErrorGroupsInput = z.input<typeof searchErrorGroupsInputSchema>;
export type GetErrorSamplesInput = z.input<typeof getErrorSamplesInputSchema>;
export type ListReleasesInput = z.input<typeof listReleasesInputSchema>;
export type CompareReleasesInput = z.input<typeof compareReleasesInputSchema>;

export type ListProjectsResult = z.infer<typeof listProjectsResultSchema>;
export type ErrorContextResult = z.infer<typeof errorContextResultSchema>;
export type SearchErrorGroupsResult = z.infer<typeof searchErrorGroupsResultSchema>;
export type ErrorSamplesResult = z.infer<typeof errorSamplesResultSchema>;
export type ListReleasesResult = z.infer<typeof listReleasesResultSchema>;
export type CompareReleasesResult = z.infer<typeof compareReleasesResultSchema>;
