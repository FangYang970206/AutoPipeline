export type NamedOutputs = Record<string, string>;
export type OutputContext = Record<string, Record<string, NamedOutputs>>;
export interface TemplateReference {
  raw: string;
  unitName: string;
  commandName: string;
  key: string;
}

const outputPattern = /^::set-output name=([A-Za-z_][A-Za-z0-9_-]*)::(.*)$/;
const templatePattern = /\{\{\s*([^.{}]+)\.([^.{}]+)\.([A-Za-z0-9_-]+)\s*\}\}/g;

export function parseNamedOutputs(stdout: string): NamedOutputs {
  const outputs: NamedOutputs = {};
  for (const line of stdout.split(/\r?\n/)) {
    const match = outputPattern.exec(line);
    if (match) {
      outputs[match[1]] = match[2];
    }
  }
  return outputs;
}

export function substituteTemplate(script: string, context: OutputContext): string {
  return script.replace(templatePattern, (raw, unitName: string, commandName: string, key: string) => {
    const value = context[unitName.trim()]?.[commandName.trim()]?.[key];
    if (value === undefined) {
      throw new Error(`Unknown template reference: ${raw}`);
    }
    return value;
  });
}

export function extractTemplateReferences(script: string): TemplateReference[] {
  return [...script.matchAll(templatePattern)].map((match) => ({
    raw: match[0],
    unitName: match[1].trim(),
    commandName: match[2].trim(),
    key: match[3],
  }));
}

export function renameUnitReferences(script: string, oldName: string, newName: string): string {
  return rewriteTemplateReferences(script, (reference) =>
    reference.unitName === oldName ? { ...reference, unitName: newName } : reference,
  );
}

export function renameCommandReferences(
  script: string,
  unitName: string,
  oldCommandName: string,
  newCommandName: string,
): string {
  return rewriteTemplateReferences(script, (reference) =>
    reference.unitName === unitName && reference.commandName === oldCommandName
      ? { ...reference, commandName: newCommandName }
      : reference,
  );
}

export function listTemplateCompletions(context: OutputContext): string[] {
  return Object.entries(context).flatMap(([unitName, commands]) =>
    Object.entries(commands).flatMap(([commandName, outputs]) =>
      Object.keys(outputs).map((key) => `{{${unitName}.${commandName}.${key}}}`),
    ),
  );
}

export function storeOutputs(
  context: OutputContext,
  unitName: string,
  commandName: string,
  outputs: NamedOutputs,
): OutputContext {
  if (Object.keys(outputs).length === 0) {
    return context;
  }
  return {
    ...context,
    [unitName]: {
      ...(context[unitName] ?? {}),
      [commandName]: outputs,
    },
  };
}

function rewriteTemplateReferences(
  script: string,
  rewrite: (reference: Omit<TemplateReference, 'raw'>) => Omit<TemplateReference, 'raw'>,
): string {
  return script.replace(templatePattern, (raw, unitName: string, commandName: string, key: string) => {
    const next = rewrite({ unitName: unitName.trim(), commandName: commandName.trim(), key });
    if (next.unitName === unitName.trim() && next.commandName === commandName.trim() && next.key === key) {
      return raw;
    }
    return `{{${next.unitName}.${next.commandName}.${next.key}}}`;
  });
}
