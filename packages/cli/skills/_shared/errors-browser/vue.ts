import {
  captureBrowserError,
  initVolatoBrowser,
  type BrowserConfig,
} from "./browser";

type VueErrorHandler = (
  error: unknown,
  instance: unknown,
  info: string,
) => unknown;

export type VueApplication = {
  config: {
    errorHandler?: VueErrorHandler;
  };
};

export function installVolatoVue(
  app: VueApplication,
  config: BrowserConfig = {},
): void {
  initVolatoBrowser(config);
  const previous = app.config.errorHandler;
  app.config.errorHandler = (error, instance, info) => {
    void captureBrowserError(error, { capturedVia: "vue_error_handler" });
    return previous?.(error, instance, info);
  };
}
