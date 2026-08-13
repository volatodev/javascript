export function isExperimentalProductEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.VOLATO_EXPERIMENTAL_PRODUCT === "1";
}
