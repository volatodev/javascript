import type { NextRequest } from "next/server";

import { wrapMiddleware } from "./volato/middleware";

const middleware = async (_request: NextRequest): Promise<Response> =>
  new Response(null, { status: 204 });

const wrapped: typeof middleware = wrapMiddleware(middleware, { dsn: "" });

void wrapped;
