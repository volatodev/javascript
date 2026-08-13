import type { ZodType } from "zod";
import {
  compareReleasesInputSchema,
  compareReleasesResultSchema,
  errorContextResultSchema,
  errorSamplesResultSchema,
  getErrorContextInputSchema,
  getErrorSamplesInputSchema,
  listProjectsInputSchema,
  listProjectsResultSchema,
  listReleasesInputSchema,
  listReleasesResultSchema,
  searchErrorGroupsInputSchema,
  searchErrorGroupsResultSchema,
  type CompareReleasesInput,
  type CompareReleasesResult,
  type ErrorContextResult,
  type ErrorSamplesResult,
  type GetErrorContextInput,
  type GetErrorSamplesInput,
  type ListProjectsInput,
  type ListProjectsResult,
  type ListReleasesInput,
  type ListReleasesResult,
  type SearchErrorGroupsInput,
  type SearchErrorGroupsResult,
} from "./contracts.js";

export * from "./contracts.js";

export type VolatoReadClientOptions = {
  baseUrl: string;
  accessToken: string | (() => string | Promise<string>);
  fetch?: typeof globalThis.fetch;
  retry?: {
    /** Additional attempts after the first request. Defaults to 2. */
    maxRetries?: number;
    /** Initial exponential-backoff delay. Defaults to 250 ms. */
    baseDelayMs?: number;
  };
  /** Test seam for retry timing. */
  sleep?: (milliseconds: number) => Promise<void>;
};

export type VolatoReadResult<T> = {
  markdown: string;
  data: T;
};

export class VolatoReadError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "VolatoReadError";
  }
}

function query(input: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export class VolatoReadClient {
  readonly #baseUrl: string;
  readonly #accessToken: VolatoReadClientOptions["accessToken"];
  readonly #fetch: typeof globalThis.fetch;
  readonly #maxRetries: number;
  readonly #baseDelayMs: number;
  readonly #sleep: (milliseconds: number) => Promise<void>;

  constructor(options: VolatoReadClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#accessToken = options.accessToken;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#maxRetries = options.retry?.maxRetries ?? 2;
    this.#baseDelayMs = options.retry?.baseDelayMs ?? 250;
    this.#sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds)));
  }

  async #token(): Promise<string> {
    const token =
      typeof this.#accessToken === "function"
        ? await this.#accessToken()
        : this.#accessToken;
    if (!token.trim()) throw new VolatoReadError("unauthorized", 401, "Missing access token.");
    return token;
  }

  async #get<T>(path: string, schema: ZodType<T>): Promise<VolatoReadResult<T>> {
    const token = await this.#token();
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.#fetch(`${this.#baseUrl}${path}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error) {
        if (attempt < this.#maxRetries) {
          await this.#sleep(this.#baseDelayMs * 2 ** attempt);
          continue;
        }
        throw new VolatoReadError(
          "network_unavailable",
          503,
          error instanceof Error ? error.message : "Volato API is unavailable.",
        );
      }

      const body = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!response.ok) {
        if (
          attempt < this.#maxRetries &&
          (response.status === 502 ||
            response.status === 503 ||
            response.status === 504)
        ) {
          await this.#sleep(this.#baseDelayMs * 2 ** attempt);
          continue;
        }
        const code = typeof body.error === "string" ? body.error : "read_failed";
        const message =
          typeof body.message === "string"
            ? body.message
            : typeof body.markdown === "string"
              ? body.markdown
              : code;
        const rawRetry = response.headers.get("retry-after");
        throw new VolatoReadError(
          code,
          response.status,
          message,
          rawRetry && /^\d+$/.test(rawRetry) ? Number(rawRetry) : undefined,
        );
      }
      return {
        markdown: typeof body.markdown === "string" ? body.markdown : "",
        data: schema.parse(body.data),
      };
    }
  }

  listProjects(input: ListProjectsInput = {}): Promise<VolatoReadResult<ListProjectsResult>> {
    const parsed = listProjectsInputSchema.parse(input);
    return this.#get(`/v1/projects${query(parsed)}`, listProjectsResultSchema);
  }

  getErrorContext(input: GetErrorContextInput = {}): Promise<VolatoReadResult<ErrorContextResult>> {
    const parsed = getErrorContextInputSchema.parse(input);
    return this.#get(`/v1/errors/context${query(parsed)}`, errorContextResultSchema);
  }

  searchErrorGroups(input: SearchErrorGroupsInput = {}): Promise<VolatoReadResult<SearchErrorGroupsResult>> {
    const parsed = searchErrorGroupsInputSchema.parse(input);
    return this.#get(`/v1/errors${query(parsed)}`, searchErrorGroupsResultSchema);
  }

  getErrorSamples(input: GetErrorSamplesInput): Promise<VolatoReadResult<ErrorSamplesResult>> {
    const parsed = getErrorSamplesInputSchema.parse(input);
    const { id, ...filters } = parsed;
    return this.#get(
      `/v1/errors/${encodeURIComponent(id)}/events${query(filters)}`,
      errorSamplesResultSchema,
    );
  }

  listReleases(input: ListReleasesInput = {}): Promise<VolatoReadResult<ListReleasesResult>> {
    const parsed = listReleasesInputSchema.parse(input);
    return this.#get(`/v1/releases${query(parsed)}`, listReleasesResultSchema);
  }

  compareReleases(input: CompareReleasesInput = {}): Promise<VolatoReadResult<CompareReleasesResult>> {
    const parsed = compareReleasesInputSchema.parse(input);
    return this.#get(`/v1/releases/compare${query(parsed)}`, compareReleasesResultSchema);
  }
}
