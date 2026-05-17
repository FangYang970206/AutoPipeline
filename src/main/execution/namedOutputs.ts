export type NamedOutputs = Record<string, string>;
export type OutputContext = Record<string, Record<string, NamedOutputs>>;

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
