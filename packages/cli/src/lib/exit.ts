/**
 * Process exit codes for the `volato` CLI.
 *
 * 0 = success, 1 = generic/local/usage error. The classed codes let an
 * agent branch on the failure class without parsing stderr: re-login on
 * AUTH, back off on RATE_LIMIT, stop on NOT_FOUND. Documented in
 * `volato readme` so an agent discovers the contract.
 */
export const EXIT = {
  OK: 0,
  GENERAL: 1,
  AUTH: 3, // 401 invalid/missing token, 402 subscription inactive
  NOT_FOUND: 4, // 404 — no such error group or project
  RATE_LIMIT: 5, // 429 — over the per-minute budget
} as const;

/** Map an API HTTP status to the CLI exit code it should produce. */
export function exitCodeForStatus(status: number): number {
  switch (status) {
    case 401:
    case 402:
      return EXIT.AUTH;
    case 404:
      return EXIT.NOT_FOUND;
    case 429:
      return EXIT.RATE_LIMIT;
    default:
      return EXIT.GENERAL;
  }
}
