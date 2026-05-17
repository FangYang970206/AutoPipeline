import { ipcMain } from 'electron';
import { KeytarCredentialStore } from '../src/main/server/credentialStore.js';
import { ServerInUseError, ServerRepository } from '../src/main/server/serverRepository.js';
import { SshConnectionTester } from '../src/main/server/sshConnectionTester.js';
import type { ServerInput } from '../src/main/server/types.js';
import { getDatabase } from './database.js';

export function registerServerHandlers() {
  const repository = new ServerRepository(getDatabase(), new KeytarCredentialStore(), {
    findPipelineNamesUsingServer: () => [],
  });
  const sshTester = new SshConnectionTester();

  ipcMain.handle('servers:list', () => repository.list());
  ipcMain.handle('servers:create', (_event, input: ServerInput) => repository.create(input));
  ipcMain.handle('servers:update', (_event, id: number, input: ServerInput) => repository.update(id, input));
  ipcMain.handle('servers:delete', async (_event, id: number) => {
    try {
      await repository.delete(id);
    } catch (error) {
      if (error instanceof ServerInUseError) {
        throw new Error(error.message);
      }
      throw error;
    }
  });
  ipcMain.handle('servers:test-connection', (_event, input: ServerInput) => sshTester.testConnection(input));
}
