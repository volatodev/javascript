import { z } from "zod";

export const RuntimeSchema = z.enum([
  "nodejs",
  "edge",
  "browser",
  "react-server",
  "react-client",
]);

export type Runtime = z.infer<typeof RuntimeSchema>;

export const StackFrameSchema = z.object({
  filename: z.string().optional(),
  function: z.string().optional(),
  lineno: z.number().int().optional(),
  colno: z.number().int().optional(),
  in_app: z.boolean().optional(),
});

export type StackFrame = z.infer<typeof StackFrameSchema>;

export const ErrorEventSchema = z.object({
  event_id: z.string().uuid(),
  timestamp: z.string().datetime(),
  runtime: RuntimeSchema,
  message: z.string(),
  type: z.string().optional(),
  stack: z.array(StackFrameSchema).optional(),
  fingerprint: z.string().optional(),
  release: z.string().optional(),
  environment: z.string().optional(),
  request: z
    .object({
      url: z.string().optional(),
      method: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  user: z
    .object({
      id: z.string().optional(),
      email: z.string().optional(),
    })
    .optional(),
  tags: z.record(z.string(), z.string()).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
  sdk: z
    .object({
      name: z.string(),
      version: z.string(),
    })
    .optional(),
});

export type ErrorEvent = z.infer<typeof ErrorEventSchema>;
