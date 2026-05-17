import { ipcMain } from 'electron';
import { CommandRepository } from '../src/main/command/commandRepository.js';
import type { CommandInput } from '../src/main/command/types.js';
import { getDatabase } from './database.js';

export function registerCommandHandlers() {
  const repository = new CommandRepository(getDatabase());

  ipcMain.handle('commands:list', (_event, unitId: string) => repository.listCommands(unitId));
  ipcMain.handle('commands:save', (_event, unitId: string, commands: CommandInput[]) =>
    repository.saveCommands(unitId, commands),
  );
  ipcMain.handle('commands:delete', (_event, id: string) => repository.deleteCommand(id));
  ipcMain.handle('commands:reorder', (_event, unitId: string, orderedIds: string[]) =>
    repository.reorderCommands(unitId, orderedIds),
  );
}
