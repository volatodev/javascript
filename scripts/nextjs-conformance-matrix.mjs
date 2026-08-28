const NEXTJS_VERSIONS = [
  { next: "15.5.22", react: "19.2.8" },
  { next: "16.2.12", react: "19.2.8" },
];

const NEXTJS_ROUTERS = ["app", "pages", "hybrid"];
const NEXTJS_LANGUAGES = ["ts", "js"];

/**
 * Executable Next.js coverage shared by the canary and public support
 * projection. A public router or major-version claim must exist here first.
 */
export const NEXTJS_CONFORMANCE_MATRIX = NEXTJS_VERSIONS.flatMap((version) =>
  NEXTJS_ROUTERS.flatMap((router) =>
    NEXTJS_LANGUAGES.map((language) => ({
      ...version,
      router,
      language,
      appDir:
        router === "pages"
          ? null
          : router === "hybrid" && language === "js"
            ? version.next.startsWith("15.")
              ? "app"
              : "src/app"
            : language === "js"
              ? "src/app"
              : "app",
      pagesDir:
        router === "app"
          ? null
          : router === "hybrid" && language === "js"
            ? "src/pages"
            : language === "js"
              ? "src/pages"
              : "pages",
      configKind:
        language === "js"
          ? "commonjs"
          : version.next.startsWith("15.") && router === "pages"
            ? "missing"
            : "typescript",
      existingInstrumentation:
        version.next.startsWith("16.") && router === "app" && language === "ts",
      label: `Next.js ${version.next.split(".")[0]} ${
        router === "app"
          ? "App Router"
          : router === "pages"
            ? "Pages Router"
            : "App + Pages Router"
      } ${language === "ts" ? "TypeScript" : "JavaScript"}`,
    })),
  ),
);
