import type { Database } from 'better-sqlite3';
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
    const save = this.db.transaction(() => {
      this.db.prepare('delete from commands where unit_id = ?').run(unitId);
      const insert = this.db.prepare(
        'insert into commands (id, unit_id, command_order, type, config) values (?, ?, ?, ?, ?)',
      );
      for (const command of commands) {
        insert.run(command.id, unitId, command.order, command.type, JSON.stringify(command.config));
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
