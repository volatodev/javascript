import {
  VolatoReadClient,
  VolatoReadError,
  type VolatoReadResult,
} from "@volatodev/read-client";
import {
  loadToken,
  resolveApiBase,
  type ApiResponse,
} from "./api-client.js";

export async function readApi<T>(
  operation: (client: VolatoReadClient) => Promise<VolatoReadResult<T>>,
): Promise<ApiResponse<T>> {
  const client = new VolatoReadClient({
    baseUrl: resolveApiBase(),
    accessToken: loadToken,
  });
  try {
    const result = await operation(client);
    return { ok: true, status: 200, ...result };
  } catch (error) {
    if (!(error instanceof VolatoReadError)) throw error;
    return {
      ok: false,
      status: error.status,
      error: error.code,
      message: error.message,
      retryAfter: error.retryAfter,
    };
  }
}
