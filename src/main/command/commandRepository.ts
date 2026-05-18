import type { Database } from 'better-sqlite3';
import { renameCommandReferences } from '../execution/namedOutputs.js';
import { validateTemplateReferences } from '../execution/templateValidation.js';
import type { CommandConfig, CommandInput, CommandRecord, CommandType, ShellCommandConfig, TransferCommandConfig } from './types.js';

interface CommandRow {
  id: string;
  unit_id: string;
  command_order: number;
  type: CommandType;
  config: string;
}

export class CommandRepository {
  constructor(private readonly db: Database) {}

  saveCommands(unitId: string, commands: CommandInput[]): void {
    const unit = this.db.prepare('select pipeline_id, name from execution_units where id = ?').get(unitId) as
      | { pipeline_id: number; name: string }
      | undefined;
    const previousCommands = this.listCommands(unitId);
    const commandRenames =
      unit === undefined
        ? []
        : commands.flatMap((command) => {
            const previous = previousCommands.find((item) => item.id === command.id);
            return previous && previous.config.name !== command.config.name
              ? [{ unitName: unit.name, oldName: previous.config.name, newName: command.config.name }]
              : [];
          });
    if (unit) {
      validateShellSessions(
        commands,
        this.buildShellSessionValidationInput(unit.pipeline_id, unitId, commands),
      );
      const errors = validateTemplateReferences(
        this.buildTemplateValidationInput(unit.pipeline_id, unitId, commands, commandRenames),
      );
      if (errors.length > 0) {
        throw new Error(errors.join('; '));
      }
    }
    const save = this.db.transaction(() => {
      this.db.prepare('delete from commands where unit_id = ?').run(unitId);
      const insert = this.db.prepare(
        'insert into commands (id, unit_id, command_order, type, config) values (?, ?, ?, ?, ?)',
      );
      for (const command of commands) {
        insert.run(command.id, unitId, command.order, command.type, JSON.stringify(command.config));
      }
      if (unit) {
        for (const command of commands) {
          const previous = previousCommands.find((item) => item.id === command.id);
          if (previous && previous.config.name !== command.config.name) {
            this.updateShellScriptsInPipeline(unit.pipeline_id, (script) =>
              renameCommandReferences(script, unit.name, previous.config.name, command.config.name),
            );
          }
        }
      }
    });

    save();
  }

  listCommands(unitId: string): CommandRecord[] {
    return this.db
      .prepare('select * from commands where unit_id = ? order by command_order asc')
      .all(unitId)
      .map((row) => mapCommand(row as CommandRow));
  }

  reorderCommands(unitId: string, orderedIds: string[]): void {
    const update = this.db.transaction(() => {
      orderedIds.forEach((id, index) => {
        this.db
          .prepare('update commands set command_order = ? where unit_id = ? and id = ?')
          .run(index, unitId, id);
      });
    });

    update();
  }

  deleteCommand(id: string): void {
    this.db.prepare('delete from commands where id = ?').run(id);
  }

  private updateShellScriptsInPipeline(pipelineId: number, rewrite: (script: string) => string) {
    const rows = this.db
      .prepare(
        `select commands.id, commands.config
           from commands
           join execution_units on execution_units.id = commands.unit_id
          where execution_units.pipeline_id = ? and commands.type = 'shell'`,
      )
      .all(pipelineId) as Array<{ id: string; config: string }>;
    const update = this.db.prepare('update commands set config = ? where id = ?');
    for (const row of rows) {
      const config = JSON.parse(row.config) as ShellCommandConfig;
      const nextScript = rewrite(config.script);
      if (nextScript !== config.script) {
        update.run(JSON.stringify({ ...config, script: nextScript }), row.id);
      }
    }
  }

  private buildTemplateValidationInput(
    pipelineId: number,
    unitId: string,
    nextCommands: CommandInput[],
    commandRenames: Array<{ unitName: string; oldName: string; newName: string }>,
  ) {
    const pipeline = this.db.prepare('select dag_edges, parameters from pipelines where id = ?').get(pipelineId) as
      | { dag_edges: string; parameters: string }
      | undefined;
    const units = this.db.prepare('select id, name from execution_units where pipeline_id = ? order by rowid').all(pipelineId) as Array<{
      id: string;
      name: string;
    }>;
    const commandRows = this.db
      .prepare(
        `select commands.*
           from commands
           join execution_units on execution_units.id = commands.unit_id
          where execution_units.pipeline_id = ?
          order by execution_units.rowid, commands.command_order`,
      )
      .all(pipelineId) as CommandRow[];
    const commandsByUnit = new Map<string, CommandInput[]>();
    for (const row of commandRows) {
      const { unitId: rowUnitId, ...command } = mapCommand(row);
      if (rowUnitId === unitId) {
        continue;
      }
      commandsByUnit.set(rowUnitId, [...(commandsByUnit.get(rowUnitId) ?? []), rewriteCommandForValidation(command, commandRenames)]);
    }
    commandsByUnit.set(unitId, nextCommands.map((command) => rewriteCommandForValidation(command, commandRenames)));
    return {
      units,
      edges: pipeline ? (JSON.parse(pipeline.dag_edges) as Array<{ source: string; target: string }>) : [],
      commandsByUnit,
      parameterNames: pipeline
        ? (JSON.parse(pipeline.parameters) as Array<{ name: string }>).map((parameter) => parameter.name)
        : [],
    };
  }

  private buildShellSessionValidationInput(pipelineId: number, unitId: string, nextCommands: CommandInput[]) {
    const pipeline = this.db.prepare('select shell_sessions from pipelines where id = ?').get(pipelineId) as
      | { shell_sessions: string }
      | undefined;
    const commandRows = this.db
      .prepare(
        `select commands.*
           from commands
           join execution_units on execution_units.id = commands.unit_id
          where execution_units.pipeline_id = ?
          order by execution_units.rowid, commands.command_order`,
      )
      .all(pipelineId) as CommandRow[];
    const allCommands: CommandInput[] = [];
    for (const row of commandRows) {
      const { unitId: rowUnitId, ...command } = mapCommand(row);
      if (rowUnitId !== unitId) {
        allCommands.push(command);
      }
    }
    allCommands.push(...nextCommands);
    return {
      allCommands,
      shellSessions: pipeline ? (JSON.parse(pipeline.shell_sessions) as string[]) : [],
    };
  }
}

function validateShellSessions(
  commands: CommandInput[],
  context: { allCommands: CommandInput[]; shellSessions: string[] },
) {
  const definedSessions = new Set(context.shellSessions);
  for (const command of commands) {
    if (command.type !== 'shell' || !command.config.reuseSession) {
      continue;
    }
    if (!command.config.sessionName) {
      throw new Error('Shell session name is required when reuseSession is enabled');
    }
    if (!definedSessions.has(command.config.sessionName)) {
      throw new Error(`Unknown shell session: ${command.config.sessionName}`);
    }
  }

  const targets = new Map<string, string>();
  for (const command of context.allCommands) {
    if (command.type !== 'shell' || !command.config.reuseSession || !command.config.sessionName) {
      continue;
    }
    const target = `${command.config.serverId ?? 'local'}:${command.config.shellType}`;
    const previousTarget = targets.get(command.config.sessionName);
    if (previousTarget && previousTarget !== target) {
      throw new Error(`Shell session ${command.config.sessionName} is used with incompatible targets`);
    }
    targets.set(command.config.sessionName, target);
  }
}

function rewriteCommandForValidation(
  command: CommandInput,
  commandRenames: Array<{ unitName: string; oldName: string; newName: string }>,
): CommandInput {
  if (command.type !== 'shell') {
    return command;
  }
  return {
    ...command,
    config: {
      ...command.config,
      script: commandRenames.reduce(
        (script, rename) => renameCommandReferences(script, rename.unitName, rename.oldName, rename.newName),
        command.config.script,
      ),
    },
  };
}

function mapCommand(row: CommandRow): CommandRecord {
  const config = JSON.parse(row.config) as CommandConfig;
  if (row.type === 'shell') {
    return {
      id: row.id,
      unitId: row.unit_id,
      order: row.command_order,
      type: row.type,
      config: config as ShellCommandConfig,
    };
  }

  return {
    id: row.id,
    unitId: row.unit_id,
    order: row.command_order,
    type: row.type,
    config: config as TransferCommandConfig,
  };
}
