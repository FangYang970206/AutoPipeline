import type { CommandInput } from '../command/types.js';
import { extractParameterReferences, extractTemplateReferences, parseNamedOutputs } from './namedOutputs.js';

export interface TemplateValidationInput {
  units: Array<{ id: string; name: string }>;
  edges: Array<{ source: string; target: string }>;
  commandsByUnit: Map<string, CommandInput[]>;
  parameterNames?: string[];
}

export function validateTemplateReferences(input: TemplateValidationInput): string[] {
  const errors: string[] = [];
  const unitsByName = new Map(input.units.map((unit) => [unit.name, unit]));

  for (const currentUnit of input.units) {
    for (const command of input.commandsByUnit.get(currentUnit.id) ?? []) {
      if (command.type !== 'shell') {
        continue;
      }
      for (const parameterName of extractParameterReferences(command.config.script)) {
        if (!(input.parameterNames ?? []).includes(parameterName)) {
          errors.push(`Unknown parameter: ${parameterName}`);
        }
      }
      for (const reference of extractTemplateReferences(command.config.script)) {
        const referencedUnit = unitsByName.get(reference.unitName);
        if (!referencedUnit) {
          errors.push(`Unknown template unit: ${reference.unitName}`);
          continue;
        }
        const referencedCommand = (input.commandsByUnit.get(referencedUnit.id) ?? []).find(
          (item) => item.config.name === reference.commandName,
        );
        if (!referencedCommand) {
          errors.push(`Unknown template command: ${reference.unitName}.${reference.commandName}`);
          continue;
        }
        if (referencedCommand.type !== 'shell' || !(reference.key in parseNamedOutputs(referencedCommand.config.script))) {
          errors.push(`Unknown template output: ${reference.raw}`);
        }
        if (!canReference(input, referencedUnit.id, referencedCommand.id, currentUnit.id, command.id)) {
          errors.push(`Template reference is not upstream: ${reference.raw}`);
        }
      }
    }
  }

  return [...new Set(errors)];
}

function canReference(
  input: TemplateValidationInput,
  referencedUnitId: string,
  referencedCommandId: string,
  currentUnitId: string,
  currentCommandId: string,
) {
  if (referencedUnitId === currentUnitId) {
    const commands = input.commandsByUnit.get(currentUnitId) ?? [];
    return commands.findIndex((command) => command.id === referencedCommandId) < commands.findIndex((command) => command.id === currentCommandId);
  }
  return hasPath(input.edges, referencedUnitId, currentUnitId);
}

function hasPath(edges: Array<{ source: string; target: string }>, source: string, target: string) {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }
  const queue = [source];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (next === target) {
      return true;
    }
    if (seen.has(next)) {
      continue;
    }
    seen.add(next);
    queue.push(...(outgoing.get(next) ?? []));
  }
  return false;
}
