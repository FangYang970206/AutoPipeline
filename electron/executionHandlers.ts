import { ipcMain } from 'electron';
import { CommandRepository } from '../src/main/command/commandRepository.js';
import { LocalShellExecutor } from '../src/main/execution/localShellExecutor.js';
import { PipelineEngine } from '../src/main/execution/pipelineEngine.js';
import { RemoteShellExecutor } from '../src/main/execution/remoteShellExecutor.js';
import { SftpTransferExecutor } from '../src/main/execution/sftpTransferExecutor.js';
import { SshConnectionPool } from '../src/main/execution/sshConnectionPool.js';
import { PipelineRepository } from '../src/main/pipeline/pipelineRepository.js';
import { KeytarCredentialStore } from '../src/main/server/credentialStore.js';
import { ServerRepository } from '../src/main/server/serverRepository.js';
import { getDatabase } from './database.js';

export function registerExecutionHandlers() {
  const db = getDatabase();
  const credentials = new KeytarCredentialStore();
  const servers = new ServerRepository(db, credentials, { findPipelineNamesUsingServer: () => [] });
  const sshPool = new SshConnectionPool(credentials);
  const engine = new PipelineEngine(
    db,
    new PipelineRepository(db),
    new CommandRepository(db),
    new LocalShellExecutor(),
    new RemoteShellExecutor(servers, sshPool),
    new SftpTransferExecutor(servers, sshPool),
  );
  engine.cleanupAllRunRetention();

  ipcMain.handle('runs:start', (event, pipelineId: number, parameters?: Record<string, unknown>) =>
    engine.runPipeline(pipelineId, parameters ?? {}, (payload) => {
      event.sender.send('runs:event', payload);
    }),
  );
  ipcMain.handle('runs:cancel', (_event, runId: number) => engine.cancelRun(runId));
  ipcMain.handle('runs:resume', (event, runId: number) =>
    engine.resumeRun(runId, (payload) => {
      event.sender.send('runs:event', payload);
    }),
  );
  ipcMain.handle('runs:list', (_event, pipelineId: number) => engine.listRuns(pipelineId));
  ipcMain.handle('runs:snapshot', (_event, runId: number) => engine.getRunSnapshot(runId));
  ipcMain.handle('settings:retention:get', () => engine.getRetentionSettings());
  ipcMain.handle('settings:retention:update', (_event, settings: { maxDays: number; maxCount: number }) =>
    engine.updateRetentionSettings(settings),
  );
}
