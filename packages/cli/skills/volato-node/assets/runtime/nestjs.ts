import { ArgumentsHost, Catch, HttpException } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { captureNodeException } from "./node.js";

type NestRequest = {
  method?: unknown;
  id?: unknown;
  route?: { path?: unknown };
  routeOptions?: { url?: unknown };
  get?: (name: string) => unknown;
};

type NestResponse = {
  statusCode?: unknown;
};

function safeString(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, max)
    : undefined;
}

function normalizedRoute(request: NestRequest): string | undefined {
  const candidate = request.routeOptions?.url ?? request.route?.path;
  return safeString(candidate, 4_096)
    ?.split(/[?#]/, 1)[0]
    ?.replace(/\/{2,}/g, "/");
}

function exceptionStatus(
  exception: unknown,
  response: NestResponse,
): number | undefined {
  if (exception instanceof HttpException) return exception.getStatus();
  if (
    typeof response.statusCode === "number" &&
    response.statusCode >= 400 &&
    response.statusCode <= 599
  ) {
    return response.statusCode;
  }
  if (typeof exception === "object" && exception !== null) {
    const statusCode = (exception as { statusCode?: unknown }).statusCode;
    if (
      typeof statusCode === "number" &&
      statusCode >= 400 &&
      statusCode <= 599
    ) {
      return statusCode;
    }
  }
  return 500;
}

@Catch()
export class VolatoHttpExceptionFilter extends BaseExceptionFilter {
  override async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const http = host.switchToHttp();
    const request = http.getRequest<NestRequest>();
    const response = http.getResponse<NestResponse>();
    try {
      const requestId = request.id ?? request.get?.("x-request-id");
      await captureNodeException(exception, {
        capturedVia: "nest_exception_filter",
        method: safeString(request.method, 32),
        route: normalizedRoute(request),
        status: exceptionStatus(exception, response),
        requestId: safeString(requestId, 256),
      });
    } finally {
      super.catch(exception, host);
    }
  }
}
