import {
  ErrorHandler,
  inject,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from "@angular/core";
import { captureBrowserError, initVolatoBrowser } from "./browser";

const composedHandlers = new WeakSet<ErrorHandler>();

/**
 * Compose the root Angular ErrorHandler without replacing application-owned
 * behaviour. Keep this provider before Angular's browser-global listeners so
 * direct window failures retain their more precise capture path and Angular's
 * forwarding of the same Error is deduplicated by the shared browser runtime.
 */
export function provideVolatoAngular(): EnvironmentProviders {
  return provideEnvironmentInitializer(() => {
    initVolatoBrowser();
    const handler = inject(ErrorHandler);
    if (composedHandlers.has(handler)) return;
    const original = handler.handleError;
    if (typeof original !== "function") {
      throw new Error("[Volato] Angular ErrorHandler cannot be composed.");
    }
    handler.handleError = function volatoAngularErrorHandler(error: unknown): void {
      void captureBrowserError(error, {
        capturedVia: "angular_error_handler",
      });
      return original.call(this, error);
    };
    composedHandlers.add(handler);
  });
}
