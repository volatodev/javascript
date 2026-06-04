/**
 * Wire format — the single source of truth for the JSON payload
 * the SDK sends to `/api/ingest` and the platform validates
 * before storing. Defined as zod schemas so both ends of the
 * pipe share one definition; never duplicate the shape on the
 * platform side.
 *
 * Every event passes through `ErrorEventSchema.passthrough()`
 * so unknown fields survive into the stored `payload jsonb` —
 * a new optional field can ship in the SDK and start showing
 * up in the agent/CLI output without an ingest deploy. Required
 * fields are always added as `.optional()` to keep older SDK
 * versions backward-compatible.
 */
import { z } from "zod";

export const RuntimeSchema = z.enum([
  "client",
  "rsc",
  "server_action",
  "route_handler",
  "middleware",
]);
export type Runtime = z.infer<typeof RuntimeSchema>;

/**
 * Which SDK code path captured this event. Lets the agent (and the
 * dashboard, if anyone ever needs it) tell apart "thrown by user code
 * inside wrapAction" from "leaked into onRequestError" from "rejected
 * a promise nobody handled". Useful when the same bug manifests
 * differently depending on the boundary it crossed.
 */
export const CapturedViaSchema = z.enum([
  "wrap_action",
  "wrap_route",
  "wrap_middleware",
  "on_request_error",
  "window_error",
  "unhandled_rejection",
  "error_boundary",
  "console",
  "manual",
]);
export type CapturedVia = z.infer<typeof CapturedViaSchema>;

/**
 * The HTTP request that triggered this event, if there was one. Bodies
 * are NEVER captured — too much PII risk. The agent gets the URL and
 * (string-coerced) query params so it can reproduce the request shape;
 * if the user wants the full body they reproduce locally.
 */
export const RequestInputSchema = z
  .object({
    method: z.string(),
    url: z.string(),
    pathname: z.string().optional(),
    searchParams: z
      .record(z.string(), z.union([z.string(), z.array(z.string())]))
      .optional(),
  })
  .passthrough();
export type RequestInput = z.infer<typeof RequestInputSchema>;

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
    /**
     * Wire-format version discriminator. Optional, and an absent value
     * means v1 (the original 0.1.0 shape) — SDKs that never send it
     * stay valid forever. A future breaking change to the payload
     * ships as `v: 2` so ingest can route old vs new payloads without
     * sniffing field shapes; widen this to a union when that day comes.
     */
    v: z.literal(1).optional(),

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
    extra: z.record(z.string(), z.unknown()).optional(),

    capturedVia: CapturedViaSchema.optional(),
    request: RequestInputSchema.optional(),
  })
  .passthrough();
export type ErrorEvent = z.infer<typeof ErrorEventSchema>;

export const VOLATO_DSN_HEADER = "X-Volato-DSN";
export const VOLATO_USAGE_WARN_HEADER = "X-Volato-Usage-Warn";
export const VOLATO_REASON_HEADER = "X-Volato-Reason";
