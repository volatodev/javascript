import { captureBrowserError, initVolatoBrowser } from "./browser";

type ClientErrorInput = {
  error: unknown;
  message: string;
};

type ClientErrorHandler = (
  this: unknown,
  input: ClientErrorInput,
) => unknown;

initVolatoBrowser();

export function createVolatoSvelteKitClientHandleError<
  Handler extends (this: unknown, input: never) => unknown,
>(application: Handler): Handler;
export function createVolatoSvelteKitClientHandleError(): (
  input: ClientErrorInput,
) => { message: string };
export function createVolatoSvelteKitClientHandleError(
  application?: ClientErrorHandler,
): ClientErrorHandler {
  return function volatoSvelteKitClientHandleError(
    this: unknown,
    input: ClientErrorInput,
  ): unknown {
    void captureBrowserError(input.error, {
      capturedVia: "sveltekit_client_handle_error",
    });
    if (application) return application.call(this, input);
    return { message: input.message };
  };
}
