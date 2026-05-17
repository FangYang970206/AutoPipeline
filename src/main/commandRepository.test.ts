import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { CommandRepository } from './command/commandRepository';
import { migratePipelineSchema } from './pipeline/schema';
import { PipelineRepository } from './pipeline/pipelineRepository';

function createRepository() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = on');
  migratePipelineSchema(db);
  const pipelines = new PipelineRepository(db);
  const pipeline = pipelines.createPipeline({ name: 'Deploy API', folderId: null });
  pipelines.savePipelineGraph(pipeline.id, {
    units: [{ id: 'unit-a', name: 'Build', position: { x: 0, y: 0 } }],
    edges: [],
  });
  return new CommandRepository(db);
}

describe('CommandRepository', () => {
  it('saves ordered shell and transfer commands for an ExecutionUnit', () => {
    const repository = createRepository();

    repository.saveCommands('unit-a', [
      {
        id: 'cmd-1',
        type: 'shell',
        order: 0,
        config: {
          name: 'Build',
          script: 'pnpm build',
          serverId: null,
          shellType: 'powershell',
          timeout: 60,
          onFailure: 'stop',
        },
      },
      {
        id: 'cmd-2',
        type: 'transfer',
        order: 1,
        config: {
          name: 'Upload dist',
          direction: 'upload',
          source: 'dist/**/*',
          destination: '/srv/app',
          overwriteMode: 'overwrite',
          serverId: 1,
        },
      },
    ]);

    expect(repository.listCommands('unit-a')).toEqual([
      expect.objectContaining({ id: 'cmd-1', type: 'shell', order: 0 }),
      expect.objectContaining({ id: 'cmd-2', type: 'transfer', order: 1 }),
    ]);
  });

  it('reorders and deletes commands', () => {
    const repository = createRepository();
    repository.saveCommands('unit-a', [
      { id: 'cmd-1', type: 'shell', order: 0, config: { name: 'first', script: '', serverId: null, shellType: 'powershell', onFailure: 'stop' } },
      { id: 'cmd-2', type: 'shell', order: 1, config: { name: 'second', script: '', serverId: null, shellType: 'cmd', onFailure: 'continue' } },
    ]);

    repository.reorderCommands('unit-a', ['cmd-2', 'cmd-1']);
    repository.deleteCommand('cmd-1');

    expect(repository.listCommands('unit-a')).toEqual([
      expect.objectContaining({ id: 'cmd-2', order: 0 }),
    ]);
  });
});
