import pc from "picocolors";
import prompts from "prompts";
import { linkProject, manifestPath } from "../../integrations/manifest.js";
import { runSkillsInstall } from "../skills.js";
import { fetchProjectSetup, markProjectLinked } from "./project-setup.js";

export type InitOptions = {
  cwd: string;
  projectId?: string;
  nonInteractive?: boolean;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function resolveProjectId(options: InitOptions): Promise<string> {
  if (options.projectId) {
    if (!UUID_PATTERN.test(options.projectId)) {
      throw new Error("A valid Volato project id is required.");
    }
    return options.projectId;
  }
  if (options.nonInteractive) {
    throw new Error("Pass `--project <id>` to link this repository to Volato.");
  }
  const response = await prompts(
    {
      type: "text",
      name: "projectId",
      message: "Volato project id",
      validate: (value: string) =>
        UUID_PATTERN.test(value) || "Enter the project UUID shown by Volato",
    },
    {
      onCancel: () => {
        throw new Error("aborted by user");
      },
    },
  );
  return response.projectId as string;
}

/**
 * Link the current repository to one Volato project. This bootstrap is
 * intentionally framework- and domain-neutral: generated source belongs to
 * `volato errors init` and `volato analytics init`.
 */
export async function runInit(options: InitOptions): Promise<void> {
  const projectId = await resolveProjectId(options);
  process.stdout.write(`${pc.bold("volato")} init  ${pc.dim(options.cwd)}\n\n`);

  const setup = await fetchProjectSetup(projectId);
  await runSkillsInstall({
    cwd: options.cwd,
    nonInteractive: options.nonInteractive,
  });
  linkProject(options.cwd, {
    id: setup.projectId,
    name: setup.projectName,
  });

  try {
    const link = await markProjectLinked(projectId);
    if (!link.tracked) {
      process.stderr.write(
        `${pc.yellow("!")} Repository linked, but the activation milestone was not recorded.\n`,
      );
    }
  } catch (error) {
    process.stderr.write(
      `${pc.yellow("!")} Repository linked locally, but Volato could not confirm the milestone: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
  }

  process.stdout.write(
    `\n${pc.green("✓")} Connected to ${pc.bold(setup.projectName)} ${pc.dim(`(${setup.projectId})`)}.\n` +
      `  ${pc.dim("manifest")} ${manifestPath(options.cwd)}\n\n` +
      `${pc.bold("Next steps")}\n` +
      `  ${pc.dim("Errors")}    volato errors init\n` +
      `  ${pc.dim("Analytics")} volato analytics init\n`,
  );
}
