import { ipcMain } from 'electron';
import { CommandRepository } from '../src/main/command/commandRepository.js';
import { LocalShellExecutor } from '../src/main/execution/localShellExecutor.js';
import { PipelineEngine } from '../src/main/execution/pipelineEngine.js';
import { PipelineRepository } from '../src/main/pipeline/pipelineRepository.js';
import { getDatabase } from './database.js';

export function registerExecutionHandlers() {
  const db = getDatabase();
  const engine = new PipelineEngine(
    db,
    new PipelineRepository(db),
    new CommandRepository(db),
    new LocalShellExecutor(),
  );

  ipcMain.handle('runs:start', (event, pipelineId: number) =>
    engine.runPipeline(pipelineId, (payload) => {
      event.sender.send('runs:event', payload);
    }),
  );
}
