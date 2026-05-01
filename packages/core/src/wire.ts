import { z } from "zod";

export const RuntimeSchema = z.enum([
  "client",
  "rsc",
  "server_action",
  "route_handler",
  "middleware",
]);

export type Runtime = z.infer<typeof RuntimeSchema>;

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
  })
  .passthrough();

export type ErrorEvent = z.infer<typeof ErrorEventSchema>;

export const VOLATO_DSN_HEADER = "X-Volato-DSN";
export const VOLATO_USAGE_WARN_HEADER = "X-Volato-Usage-Warn";
export const VOLATO_REASON_HEADER = "X-Volato-Reason";
