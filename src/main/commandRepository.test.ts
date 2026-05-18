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
  pipelines.updateShellSessions(pipeline.id, ['deploy']);
  pipelines.savePipelineGraph(pipeline.id, {
    units: [{ id: 'unit-a', name: 'Build', position: { x: 0, y: 0 } }],
    edges: [],
  });
  return new CommandRepository(db);
}

function createPipelineWithCommands() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = on');
  migratePipelineSchema(db);
  const pipelines = new PipelineRepository(db);
  const pipeline = pipelines.createPipeline({ name: 'Deploy API', folderId: null });
  pipelines.savePipelineGraph(pipeline.id, {
    units: [
      { id: 'unit-a', name: 'Build', position: { x: 0, y: 0 } },
      { id: 'unit-b', name: 'Deploy', position: { x: 200, y: 0 } },
    ],
    edges: [{ source: 'unit-a', target: 'unit-b' }],
  });
  return { commands: new CommandRepository(db), pipeline, pipelines };
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
          sessionName: 'deploy',
          reuseSession: true,
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
      expect.objectContaining({
        id: 'cmd-1',
        type: 'shell',
        order: 0,
        config: expect.objectContaining({ sessionName: 'deploy', reuseSession: true }),
      }),
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

  it('updates template references when a command is renamed', () => {
    const { commands } = createPipelineWithCommands();
    commands.saveCommands('unit-a', [
      { id: 'cmd-build', type: 'shell', order: 0, config: { name: 'Image', script: '::set-output name=tag::v1', serverId: null, shellType: 'cmd', onFailure: 'stop' } },
    ]);
    commands.saveCommands('unit-b', [
      { id: 'cmd-deploy', type: 'shell', order: 0, config: { name: 'Deploy', script: 'deploy {{Build.Image.tag}}', serverId: null, shellType: 'cmd', onFailure: 'stop' } },
    ]);

    commands.saveCommands('unit-a', [
      { id: 'cmd-build', type: 'shell', order: 0, config: { name: 'Container', script: '::set-output name=tag::v1', serverId: null, shellType: 'cmd', onFailure: 'stop' } },
    ]);

    expect(commands.listCommands('unit-b')[0].config).toMatchObject({ script: 'deploy {{Build.Container.tag}}' });
  });

  it('rejects invalid template references when commands are saved', () => {
    const { commands } = createPipelineWithCommands();
    commands.saveCommands('unit-a', [
      { id: 'cmd-build', type: 'shell', order: 0, config: { name: 'Image', script: '::set-output name=tag::v1', serverId: null, shellType: 'cmd', onFailure: 'stop' } },
    ]);

    expect(() =>
      commands.saveCommands('unit-b', [
        { id: 'cmd-deploy', type: 'shell', order: 0, config: { name: 'Deploy', script: 'deploy {{Deploy.Image.tag}} {{Build.Image.missing}}', serverId: null, shellType: 'cmd', onFailure: 'stop' } },
      ]),
    ).toThrow('Unknown template command: Deploy.Image; Unknown template output: {{Build.Image.missing}}');
  });

  it('validates shell session references and target consistency', () => {
    const { commands, pipeline, pipelines } = createPipelineWithCommands();
    pipelines.updateShellSessions(pipeline.id, ['deploy']);

    expect(() =>
      commands.saveCommands('unit-a', [
        { id: 'cmd-build', type: 'shell', order: 0, config: { name: 'Build', script: 'build', serverId: null, shellType: 'cmd', onFailure: 'stop', reuseSession: true } },
      ]),
    ).toThrow('Shell session name is required when reuseSession is enabled');
    expect(() =>
      commands.saveCommands('unit-a', [
        { id: 'cmd-build', type: 'shell', order: 0, config: { name: 'Build', script: 'build', serverId: null, shellType: 'cmd', onFailure: 'stop', sessionName: 'missing', reuseSession: true } },
      ]),
    ).toThrow('Unknown shell session: missing');
    expect(() =>
      commands.saveCommands('unit-a', [
        { id: 'cmd-build', type: 'shell', order: 0, config: { name: 'Build', script: 'build', serverId: null, shellType: 'cmd', onFailure: 'stop', sessionName: 'deploy', reuseSession: true } },
        { id: 'cmd-test', type: 'shell', order: 1, config: { name: 'Test', script: 'test', serverId: null, shellType: 'powershell', onFailure: 'stop', sessionName: 'deploy', reuseSession: true } },
      ]),
    ).toThrow('Shell session deploy is used with incompatible targets');
  });
});
