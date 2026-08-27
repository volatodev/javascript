import type { Command } from "commander";

export function commandDocumentationModel(
  command: Command,
  parentPath: string[],
) {
  const path = [...parentPath, command.name()];
  const help = command.createHelp();
  return {
    path,
    aliases: command.aliases(),
    description: command.description(),
    arguments: command.registeredArguments.map((argument) => ({
      name: argument.name(),
      description: argument.description,
      required: argument.required,
      variadic: argument.variadic,
      choices: argument.argChoices ?? null,
      defaultValue: argument.defaultValue ?? null,
    })),
    options: help.visibleOptions(command).map((option) => ({
      flags: option.flags,
      short: option.short ?? null,
      long: option.long ?? null,
      description: option.description,
      required: option.required,
      optional: option.optional,
      variadic: option.variadic,
      mandatory: option.mandatory,
      choices: option.argChoices ?? null,
      defaultValue: option.defaultValue ?? null,
    })),
  };
}

function descendantCommandModels(
  command: Command,
  parentPath: string[] = [],
): Array<ReturnType<typeof commandDocumentationModel>> {
  const path = [...parentPath, command.name()];
  return command.commands.flatMap((child) => [
    commandDocumentationModel(child, path),
    ...descendantCommandModels(child, path),
  ]);
}

export function cliDocumentationModel(program: Command) {
  return {
    name: program.name(),
    version: program.version(),
    description: program.description(),
    options: commandDocumentationModel(program, []).options,
    commands: descendantCommandModels(program),
  };
}

function tableText(value: unknown): string {
  return String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function optionTable(
  options: ReturnType<typeof commandDocumentationModel>["options"],
): string {
  if (options.length === 0) return "";
  const rows = options.map((option) => {
    const requirement = option.mandatory ? "yes" : "no";
    const defaultValue =
      option.defaultValue === null ? "—" : JSON.stringify(option.defaultValue);
    return `| \`${tableText(option.flags)}\` | ${requirement} | ${tableText(option.description)} | ${tableText(defaultValue)} |`;
  });
  return [
    "| Flags | Required option | Meaning | Default |",
    "|---|---:|---|---|",
    ...rows,
  ].join("\n");
}

function argumentTable(
  args: ReturnType<typeof commandDocumentationModel>["arguments"],
): string {
  if (args.length === 0) return "";
  const rows = args.map(
    (argument) =>
      `| \`${tableText(argument.name)}\` | ${argument.required ? "yes" : "no"} | ${argument.variadic ? "yes" : "no"} | ${tableText(argument.description)} |`,
  );
  return [
    "| Argument | Required | Variadic | Meaning |",
    "|---|---:|---:|---|",
    ...rows,
  ].join("\n");
}

export function renderCliReferenceMarkdown(program: Command): string {
  const model = cliDocumentationModel(program);
  const sections = [
    "## Generated command reference",
    "",
    "This inventory is rendered from the Commander program used by the installed CLI.",
    "",
    "### Global options",
    "",
    optionTable(model.options),
  ];

  for (const command of model.commands) {
    sections.push(
      "",
      `### \`${command.path.join(" ")}\``,
      "",
      command.description,
    );
    const args = argumentTable(command.arguments);
    if (args) sections.push("", args);
    const options = optionTable(command.options);
    if (options) sections.push("", options);
  }
  return `${sections.join("\n")}\n`;
}
