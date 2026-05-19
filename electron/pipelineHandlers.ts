import { dialog, ipcMain } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { PipelineRepository } from '../src/main/pipeline/pipelineRepository.js';
import { PipelineImportExportService, type ImportPipelineOptions } from '../src/main/pipeline/pipelineImportExport.js';
import type { PipelineGraph, PipelineParameter } from '../src/main/pipeline/types.js';
import { getDatabase } from './database.js';

export function registerPipelineHandlers() {
  const db = getDatabase();
  const repository = new PipelineRepository(db);
  const importExport = new PipelineImportExportService(db);

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
  ipcMain.handle('pipelines:update-parameters', (_event, id: number, parameters: PipelineParameter[]) =>
    repository.updateParameters(id, parameters),
  );
  ipcMain.handle('pipelines:update-shell-sessions', (_event, id: number, shellSessions: string[]) =>
    repository.updateShellSessions(id, shellSessions),
  );
  ipcMain.handle('pipelines:export-file', async (_event, id: number) => {
    const exported = importExport.exportPipeline(id);
    const result = await dialog.showSaveDialog({
      defaultPath: `${exported.pipeline.name}.json`,
      filters: [{ name: 'Pipeline JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) {
      return { filePath: null };
    }
    await writeFile(result.filePath, `${JSON.stringify(exported, null, 2)}\n`, 'utf8');
    return { filePath: result.filePath };
  });
  ipcMain.handle('pipelines:inspect-import-file', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Pipeline JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { filePath: null };
    }
    const filePath = result.filePaths[0];
    const document = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    const pipelineName = ((document as { pipeline?: { name?: string } }).pipeline?.name ?? '').trim();
    const duplicateName = db.prepare('select name from pipelines where name = ? collate nocase').get(pipelineName) ? pipelineName : null;
    return {
      filePath,
      duplicateName,
      unknownServers: importExport.findUnknownServers(document),
      localServers: (db.prepare('select display_name as displayName from servers order by display_name collate nocase').all() as Array<{ displayName: string }>).map((server) => server.displayName),
    };
  });
  ipcMain.handle('pipelines:import-file', async (_event, filePath: string, options: ImportPipelineOptions) => {
    const document = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    return importExport.importPipeline(document, options);
  });
}
