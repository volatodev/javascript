import { z } from "zod";

export const RuntimeSchema = z.enum([
  "client",
  "rsc",
  "server_action",
  "route_handler",
  "middleware",
]);
export type Runtime = z.infer<typeof RuntimeSchema>;

export const LevelSchema = z.enum([
  "fatal",
  "error",
  "warning",
  "info",
  "debug",
]);
export type Level = z.infer<typeof LevelSchema>;

/**
 * User context attached to an event. Every field is optional — populate the
 * ones you have. `ip_address: "{{auto}}"` lets the server fill it in from
 * the request connection.
 */
export const UserSchema = z
  .object({
    id: z.string().optional(),
    email: z.string().optional(),
    username: z.string().optional(),
    ip_address: z.string().optional(),
    segment: z.string().optional(),
  })
  .passthrough();
export type User = z.infer<typeof UserSchema>;

/**
 * A breadcrumb is a structured trail of what happened *before* the event
 * fired. SDKs typically auto-collect navigation, fetch, and console
 * breadcrumbs; users can add custom ones via `addBreadcrumb`.
 */
export const BreadcrumbSchema = z
  .object({
    timestamp: z.number(),
    type: z.string().optional(),
    category: z.string().optional(),
    level: LevelSchema.optional(),
    message: z.string().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export type Breadcrumb = z.infer<typeof BreadcrumbSchema>;

/**
 * Linked errors — the `error.cause` chain unwound into a flat array.
 * Each entry is the same shape as the top-level event's `type/message/stack`.
 */
export const LinkedErrorSchema = z
  .object({
    type: z.string(),
    message: z.string(),
    stack: z.union([z.string(), z.null()]).optional(),
  })
  .passthrough();
export type LinkedError = z.infer<typeof LinkedErrorSchema>;

/**
 * Open-ended context buckets. Conventional keys are `browser`, `os`,
 * `device`, `runtime`, `app` — but anything is allowed.
 */
export const ContextsSchema = z.record(
  z.string(),
  z.record(z.string(), z.unknown()),
);
export type Contexts = z.infer<typeof ContextsSchema>;

export const SdkSchema = z
  .object({
    name: z.string(),
    version: z.string(),
  })
  .passthrough();
export type Sdk = z.infer<typeof SdkSchema>;

/**
 * Wire format for a single error event. Existing fields
 * (type/message/runtime/timestamp/...) are preserved so older SDK builds
 * keep validating.
 *
 * Adds typed first-class context fields:
 *   - level, user, tags, contexts, release, fingerprint
 *   - breadcrumbs, linkedErrors
 *   - sdk identification, free-form `extra`
 *
 * `passthrough()` is intentional — unknown fields are forwarded into the
 * stored payload so we never lose data when SDK and ingest drift in
 * version, but the typed surface stays small.
 */
export const ErrorEventSchema = z
  .object({
    type: z.string(),
    message: z.string(),
    runtime: RuntimeSchema,
    timestamp: z.number(),

    stack: z.union([z.string(), z.null()]).optional(),
    url: z.string().optional(),
    userAgent: z.string().optional(),
    componentStack: z.string().optional(),
    filename: z.string().optional(),
    lineno: z.number().optional(),
    colno: z.number().optional(),
    digest: z.string().optional(),
    actionName: z.string().optional(),
    route: z.union([z.string(), z.null()]).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    method: z.string().optional(),
    environment: z.string().optional(),

    level: LevelSchema.optional(),
    user: UserSchema.optional(),
    tags: z.record(z.string(), z.string()).optional(),
    contexts: ContextsSchema.optional(),
    release: z.string().optional(),
    dist: z.string().optional(),
    fingerprint: z.array(z.string()).optional(),
    breadcrumbs: z.array(BreadcrumbSchema).optional(),
    linkedErrors: z.array(LinkedErrorSchema).optional(),
    sdk: SdkSchema.optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export type ErrorEvent = z.infer<typeof ErrorEventSchema>;

export const VOLATO_DSN_HEADER = "X-Volato-DSN";
export const VOLATO_USAGE_WARN_HEADER = "X-Volato-Usage-Warn";
export const VOLATO_REASON_HEADER = "X-Volato-Reason";
