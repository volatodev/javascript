export default function configureVolatoVue(app) {
  const applicationHandler = app.config.errorHandler;
  app.config.errorHandler = function volatoVueErrorHandler(error, instance, info) {
    const delivery = import.meta.env.SSR
      ? import("./vue-server.mjs")
      : import("./vue-client.mjs");
    void delivery
      .then(({ captureVolatoVueError }) => captureVolatoVueError(error))
      .catch((captureError) => {
        console.warn("[Volato] Astro Vue capture failed.", captureError);
      });
    if (applicationHandler) {
      return applicationHandler.call(this, error, instance, info);
    }
    console.error(error);
  };
}
