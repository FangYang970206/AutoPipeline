import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { CommandRepository } from '../command/commandRepository';
import type { LocalCommandExecutor } from './pipelineEngine';
import { PipelineEngine, PipelineAlreadyRunningError } from './pipelineEngine';
import { PipelineRepository } from '../pipeline/pipelineRepository';
import { migratePipelineSchema } from '../pipeline/schema';

function setup(executor: LocalCommandExecutor) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = on');
  migratePipelineSchema(db);
  const pipelines = new PipelineRepository(db);
  const commands = new CommandRepository(db);
  const engine = new PipelineEngine(db, pipelines, commands, executor);
  const pipeline = pipelines.createPipeline({ name: 'Deploy API', folderId: null });
  pipelines.savePipelineGraph(pipeline.id, {
    units: [
      { id: 'unit-a', name: 'Build', position: { x: 0, y: 0 } },
      { id: 'unit-b', name: 'Deploy', position: { x: 200, y: 0 } },
    ],
    edges: [{ source: 'unit-a', target: 'unit-b' }],
  });

  return { commands, db, engine, pipeline };
}

describe('PipelineEngine', () => {
  it('executes local shell commands in DAG order and records streamed output', async () => {
    const executed: string[] = [];
    const events: Array<{ type: string; data: string }> = [];
    const { commands, db, engine, pipeline } = setup({
      execute: async (command, emit) => {
        executed.push(command.config.name);
        emit({ type: 'stdout', data: `${command.config.name}\n` });
        return { exitCode: 0 };
      },
    });
    commands.saveCommands('unit-a', [
      { id: 'cmd-build', type: 'shell', order: 0, config: { name: 'Build', script: 'build', serverId: null, shellType: 'powershell', onFailure: 'stop' } },
    ]);
    commands.saveCommands('unit-b', [
      { id: 'cmd-deploy', type: 'shell', order: 0, config: { name: 'Deploy', script: 'deploy', serverId: null, shellType: 'powershell', onFailure: 'stop' } },
    ]);

    const run = await engine.runPipeline(pipeline.id, (event) => {
      if (event.type === 'stdout') {
        events.push(event);
      }
    });

    expect(run.status).toBe('succeeded');
    expect(executed).toEqual(['Build', 'Deploy']);
    expect(events.map((event) => event.data)).toEqual(['Build\n', 'Deploy\n']);
    expect(db.prepare('select status from runs where id = ?').get(run.id)).toEqual({ status: 'succeeded' });
    expect(db.prepare('select command_name, status, stdout from command_results order by id').all()).toEqual([
      { command_name: 'Build', status: 'succeeded', stdout: 'Build\n' },
      { command_name: 'Deploy', status: 'succeeded', stdout: 'Deploy\n' },
    ]);
  });

  it('applies command failure policies', async () => {
    const { commands, db, engine, pipeline } = setup({
      execute: async (command) => ({ exitCode: command.config.name === 'Test' ? 1 : 0 }),
    });
    commands.saveCommands('unit-a', [
      { id: 'cmd-test', type: 'shell', order: 0, config: { name: 'Test', script: 'test', serverId: null, shellType: 'cmd', onFailure: 'skip_unit' } },
      { id: 'cmd-package', type: 'shell', order: 1, config: { name: 'Package', script: 'package', serverId: null, shellType: 'cmd', onFailure: 'stop' } },
    ]);
    commands.saveCommands('unit-b', [
      { id: 'cmd-deploy', type: 'shell', order: 0, config: { name: 'Deploy', script: 'deploy', serverId: null, shellType: 'cmd', onFailure: 'stop' } },
    ]);

    const run = await engine.runPipeline(pipeline.id);

    expect(run.status).toBe('succeeded');
    expect(db.prepare('select command_name, status from command_results order by id').all()).toEqual([
      { command_name: 'Test', status: 'failed' },
      { command_name: 'Package', status: 'skipped' },
      { command_name: 'Deploy', status: 'succeeded' },
    ]);
  });

  it('rejects concurrent runs for the same pipeline', async () => {
    let release!: () => void;
    let started!: () => void;
    const firstCommandStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const { commands, engine, pipeline } = setup({
      execute: async () => {
        started();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { exitCode: 0 };
      },
    });
    commands.saveCommands('unit-a', [
      { id: 'cmd-build', type: 'shell', order: 0, config: { name: 'Build', script: 'build', serverId: null, shellType: 'cmd', onFailure: 'stop' } },
    ]);

    const firstRun = engine.runPipeline(pipeline.id);
    await firstCommandStarted;
    await expect(engine.runPipeline(pipeline.id)).rejects.toThrow(PipelineAlreadyRunningError);
    release();
    await firstRun;
  });
});
