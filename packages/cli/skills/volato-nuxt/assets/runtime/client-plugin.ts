import {
  captureVolatoNuxtAppError,
  captureVolatoNuxtVueError,
  installVolatoNuxtClient,
} from "../../volato-nuxt/nuxt-client";

export default defineNuxtPlugin({
  name: "volato-errors",
  enforce: "pre",
  setup: installVolatoNuxtClient,
  hooks: {
    "vue:error": captureVolatoNuxtVueError,
    "app:error": captureVolatoNuxtAppError,
  },
});
