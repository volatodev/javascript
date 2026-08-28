import { captureNodeException, initVolatoNode } from "./node.mjs";

const release =
  typeof __VOLATO_SERVER_RELEASE__ === "undefined"
    ? undefined
    : __VOLATO_SERVER_RELEASE__;

initVolatoNode({ installFatalHandlers: false, release });

export function captureVolatoVueError(error) {
  return captureNodeException(error, { capturedVia: "astro_vue_error_handler" });
}
