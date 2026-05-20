import { BrowserWindow, Notification, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { LocalShellExecutor } from '../src/main/execution/localShellExecutor.js';
import { PipelineEngine } from '../src/main/execution/pipelineEngine.js';
import { RemoteShellExecutor } from '../src/main/execution/remoteShellExecutor.js';
import { SftpTransferExecutor } from '../src/main/execution/sftpTransferExecutor.js';
import { RunNotificationService } from '../src/main/notifications/runNotifications.js';
import type { AppSettings } from '../src/main/settings/appSettings.js';
import { getDatabase } from './database.js';
import { getRuntimeServices, toPoolOptions } from './runtimeServices.js';

export function registerExecutionHandlers() {
  const { db, commands, pipelines, servers, settings, sshPool } = getRuntimeServices();
  const engine = new PipelineEngine(
    db,
    pipelines,
    commands,
    new LocalShellExecutor(),
    new RemoteShellExecutor(servers, sshPool),
    new SftpTransferExecutor(servers, sshPool),
  );
  const notifications = new RunNotificationService(
    () => settings.getAll(),
    {
      isSupported: () => Notification.isSupported(),
      show: (title, body) => new Notification({ title, body }).show(),
    },
  );
  engine.cleanupAllRunRetention();

  const notifyRunCompleted = (event: IpcMainInvokeEvent, run: Awaited<ReturnType<PipelineEngine['runPipeline']>>) => {
    notifications.notify(BrowserWindow.fromWebContents(event.sender) ?? undefined, {
      runId: run.id,
      pipelineId: run.pipelineId,
      pipelineName: getPipelineName(db, run.pipelineId),
      status: run.status === 'cancelled' ? 'cancelled' : run.status === 'failed' ? 'failed' : 'succeeded',
    });
  };

  ipcMain.handle('runs:start', async (event, pipelineId: number, parameters?: Record<string, unknown>) => {
    const run = await engine.runPipeline(pipelineId, parameters ?? {}, (payload) => {
      event.sender.send('runs:event', payload);
    });
    notifyRunCompleted(event, run);
    return run;
  });
  ipcMain.handle('runs:cancel', (_event, runId: number) => engine.cancelRun(runId));
  ipcMain.handle('runs:resume', async (event, runId: number) => {
    const run = await engine.resumeRun(runId, (payload) => {
      event.sender.send('runs:event', payload);
    });
    notifyRunCompleted(event, run);
    return run;
  });
  ipcMain.handle('runs:list', (_event, pipelineId: number) => engine.listRuns(pipelineId));
  ipcMain.handle('runs:snapshot', (_event, runId: number) => engine.getRunSnapshot(runId));
  ipcMain.handle('settings:get', () => settings.getAll());
  ipcMain.handle('settings:update', (_event, input: AppSettings) => {
    const saved = settings.updateAll(input);
    sshPool.updateOptions(toPoolOptions(saved));
    engine.cleanupAllRunRetention();
    return saved;
  });
  ipcMain.handle('settings:retention:get', () => settings.getAll().retention);
  ipcMain.handle('settings:retention:update', (_event, retention: { maxDays: number; maxCount: number }) => {
    const current = settings.getAll();
    const saved = settings.updateAll({ ...current, retention });
    engine.cleanupAllRunRetention();
    return saved.retention;
  });
}

function getPipelineName(db: ReturnType<typeof getDatabase>, pipelineId: number) {
  return (db.prepare('select name from pipelines where id = ?').get(pipelineId) as { name: string } | undefined)?.name ?? `#${pipelineId}`;
}
