export default function configureVolatoVue(app) {
  const applicationHandler = app.config.errorHandler;
  app.config.errorHandler = function volatoVueErrorHandler(error, instance, info) {
    if (!import.meta.env.SSR) {
      void import("./vue-client.mjs")
        .then(({ captureVolatoVueError }) => captureVolatoVueError(error))
        .catch((captureError) => {
          console.warn("[Volato] Astro Vue capture failed.", captureError);
        });
    }
    if (applicationHandler) {
      return applicationHandler.call(this, error, instance, info);
    }
    console.error(error);
  };
}
