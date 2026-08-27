import { captureBrowserError } from "./browser";

export function captureVolatoSvelteError(
  error: unknown,
  _reset: () => void,
): void {
  void captureBrowserError(error, { capturedVia: "svelte_boundary" });
}
