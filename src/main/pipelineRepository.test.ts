import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migratePipelineSchema } from './pipeline/schema';
import { PipelineRepository } from './pipeline/pipelineRepository';
import { CommandRepository } from './command/commandRepository';

function createRepository() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = on');
  migratePipelineSchema(db);
  return { db, repository: new PipelineRepository(db) };
}

describe('PipelineRepository', () => {
  it('creates folders and pipelines and returns a folder tree', () => {
    const { repository } = createRepository();

    const folder = repository.createFolder({ name: 'Production', parentId: null });
    repository.createPipeline({ name: 'Deploy API', folderId: folder.id });
    repository.createPipeline({ name: 'Refresh Cache', folderId: folder.id });

    expect(repository.getTree()).toEqual([
      expect.objectContaining({
        name: 'Production',
        pipelines: [
          expect.objectContaining({ name: 'Deploy API' }),
          expect.objectContaining({ name: 'Refresh Cache' }),
        ],
      }),
    ]);
  });

  it('filters pipelines by case-insensitive name while preserving folder context', () => {
    const { repository } = createRepository();
    const folder = repository.createFolder({ name: 'Production', parentId: null });
    repository.createPipeline({ name: 'Deploy API', folderId: folder.id });
    repository.createPipeline({ name: 'Refresh Cache', folderId: folder.id });

    expect(repository.search('deploy')).toEqual([
      expect.objectContaining({
        name: 'Production',
        pipelines: [expect.objectContaining({ name: 'Deploy API' })],
      }),
    ]);
  });

  it('deleting a pipeline cascades runs and command results and reports run count first', () => {
    const { db, repository } = createRepository();
    const pipeline = repository.createPipeline({ name: 'Deploy API', folderId: null });
    const run = db.prepare('insert into runs (pipeline_id, status) values (?, ?)').run(pipeline.id, 'failed');
    db.prepare('insert into command_results (run_id, command_name, status) values (?, ?, ?)').run(
      Number(run.lastInsertRowid),
      'build',
      'failed',
    );

    expect(repository.getPipelineDeleteImpact(pipeline.id)).toEqual({ runCount: 1 });
    repository.deletePipeline(pipeline.id);

    expect(db.prepare('select count(*) as count from runs').get()).toEqual({ count: 0 });
    expect(db.prepare('select count(*) as count from command_results').get()).toEqual({ count: 0 });
  });

  it('saves and loads execution units with DAG edges', () => {
    const { repository } = createRepository();
    const pipeline = repository.createPipeline({ name: 'Deploy API', folderId: null });

    repository.savePipelineGraph(pipeline.id, {
      units: [
        { id: 'unit-a', name: 'Build', position: { x: 10, y: 20 } },
        { id: 'unit-b', name: 'Deploy', position: { x: 220, y: 20 } },
      ],
      edges: [{ source: 'unit-a', target: 'unit-b' }],
    });

    expect(repository.getPipelineGraph(pipeline.id)).toEqual({
      units: [
        { id: 'unit-a', name: 'Build', position: { x: 10, y: 20 } },
        { id: 'unit-b', name: 'Deploy', position: { x: 220, y: 20 } },
      ],
      edges: [{ source: 'unit-a', target: 'unit-b' }],
    });
  });

  it('stores pipeline parameter definitions', () => {
    const { repository } = createRepository();
    const pipeline = repository.createPipeline({ name: 'Deploy API', folderId: null });

    const updated = repository.updateParameters(pipeline.id, [
      { name: 'env', type: 'select', defaultValue: 'prod', options: ['staging', 'prod'] },
    ]);

    expect(updated.parameters).toEqual([
      { name: 'env', type: 'select', defaultValue: 'prod', options: ['staging', 'prod'] },
    ]);
  });

  it('preserves commands and updates template references when an execution unit is renamed', () => {
    const { db, repository } = createRepository();
    const pipeline = repository.createPipeline({ name: 'Deploy API', folderId: null });
    repository.savePipelineGraph(pipeline.id, {
      units: [
        { id: 'unit-a', name: 'Build', position: { x: 10, y: 20 } },
        { id: 'unit-b', name: 'Deploy', position: { x: 220, y: 20 } },
      ],
      edges: [{ source: 'unit-a', target: 'unit-b' }],
    });
    const commands = new CommandRepository(db);
    commands.saveCommands('unit-a', [
      { id: 'cmd-build', type: 'shell', order: 0, config: { name: 'Image', script: '::set-output name=tag::v1', serverId: null, shellType: 'cmd', onFailure: 'stop' } },
    ]);
    commands.saveCommands('unit-b', [
      { id: 'cmd-deploy', type: 'shell', order: 0, config: { name: 'Deploy', script: 'deploy {{Build.Image.tag}}', serverId: null, shellType: 'cmd', onFailure: 'stop' } },
    ]);

    repository.savePipelineGraph(pipeline.id, {
      units: [
        { id: 'unit-a', name: 'Package', position: { x: 10, y: 20 } },
        { id: 'unit-b', name: 'Deploy', position: { x: 220, y: 20 } },
      ],
      edges: [{ source: 'unit-a', target: 'unit-b' }],
    });

    expect(commands.listCommands('unit-a')).toHaveLength(1);
    expect(commands.listCommands('unit-b')[0].config).toMatchObject({ script: 'deploy {{Package.Image.tag}}' });
  });
});
