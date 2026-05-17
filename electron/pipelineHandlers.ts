import { ipcMain } from 'electron';
import { PipelineRepository } from '../src/main/pipeline/pipelineRepository.js';
import type { PipelineGraph } from '../src/main/pipeline/types.js';
import { getDatabase } from './database.js';

export function registerPipelineHandlers() {
  const repository = new PipelineRepository(getDatabase());

  ipcMain.handle('pipelines:tree', () => repository.getTree());
  ipcMain.handle('pipelines:search', (_event, query: string) => repository.search(query));
  ipcMain.handle('folders:create', (_event, input: { name: string; parentId: number | null }) =>
    repository.createFolder(input),
  );
  ipcMain.handle('folders:rename', (_event, id: number, name: string) => repository.renameFolder(id, name));
  ipcMain.handle('folders:delete', (_event, id: number) => repository.deleteFolder(id));
  ipcMain.handle('pipelines:create', (_event, input: { name: string; folderId: number | null }) =>
    repository.createPipeline(input),
  );
  ipcMain.handle('pipelines:rename', (_event, id: number, name: string) => repository.renamePipeline(id, name));
  ipcMain.handle('pipelines:delete-impact', (_event, id: number) => repository.getPipelineDeleteImpact(id));
  ipcMain.handle('pipelines:delete', (_event, id: number) => repository.deletePipeline(id));
  ipcMain.handle('pipelines:get-graph', (_event, id: number) => repository.getPipelineGraph(id));
  ipcMain.handle('pipelines:save-graph', (_event, id: number, graph: PipelineGraph) =>
    repository.savePipelineGraph(id, graph),
  );
}
