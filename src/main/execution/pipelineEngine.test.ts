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

  return { commands, db, engine, pipeline, pipelines };
}

describe('PipelineEngine', () => {
  it('executes local shell commands in DAG order and records streamed output', async () => {
    const executed: string[] = [];
    const events: Array<{ type: string; data: string }> = [];
    const statuses: string[] = [];
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
      if (event.type === 'run-status' || event.type === 'command-status') {
        statuses.push(`${event.type}:${event.status}`);
      }
    });

    expect(run.status).toBe('succeeded');
    expect(executed).toEqual(['Build', 'Deploy']);
    expect(events.map((event) => event.data)).toEqual(['Build\n', 'Deploy\n']);
    expect(statuses).toEqual([
      'run-status:pending',
      'run-status:running',
      'command-status:pending',
      'command-status:running',
      'command-status:succeeded',
      'command-status:pending',
      'command-status:running',
      'command-status:succeeded',
      'run-status:succeeded',
    ]);
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

  it('allows different pipelines to run concurrently', async () => {
    const releases: Array<() => void> = [];
    let started = 0;
    let markStarted!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      markStarted = () => {
        started += 1;
        if (started === 2) {
          resolve();
        }
      };
    });
    const { commands, engine, pipeline, pipelines } = setup({
      execute: async () => {
        markStarted();
        await new Promise<void>((resolveRun) => {
          releases.push(resolveRun);
        });
        return { exitCode: 0 };
      },
    });
    commands.saveCommands('unit-a', [
      { id: 'cmd-build-a', type: 'shell', order: 0, config: { name: 'Build A', script: 'build', serverId: null, shellType: 'cmd', onFailure: 'stop' } },
    ]);
    const otherPipeline = pipelines.createPipeline({ name: 'Deploy Worker', folderId: null });
    pipelines.savePipelineGraph(otherPipeline.id, {
      units: [{ id: 'unit-c', name: 'Build C', position: { x: 0, y: 0 } }],
      edges: [],
    });
    commands.saveCommands('unit-c', [
      { id: 'cmd-build-c', type: 'shell', order: 0, config: { name: 'Build C', script: 'build', serverId: null, shellType: 'cmd', onFailure: 'stop' } },
    ]);

    const firstRun = engine.runPipeline(pipeline.id);
    const secondRun = engine.runPipeline(otherPipeline.id);

    await bothStarted;
    for (const release of releases) {
      release();
    }
    await Promise.all([firstRun, secondRun]);
  });

  it('routes shell commands with a server to the remote executor', async () => {
    const localExecuted: string[] = [];
    const remoteExecuted: string[] = [];
    const db = new Database(':memory:');
    db.pragma('foreign_keys = on');
    migratePipelineSchema(db);
    const pipelines = new PipelineRepository(db);
    const commands = new CommandRepository(db);
    const engine = new PipelineEngine(
      db,
      pipelines,
      commands,
      {
        execute: async (command) => {
          localExecuted.push(command.config.name);
          return { exitCode: 0 };
        },
      },
      {
        execute: async (command, emit) => {
          remoteExecuted.push(command.config.name);
          emit({ type: 'stdout', data: 'remote\n' });
          return { exitCode: 0 };
        },
      },
    );
    const pipeline = pipelines.createPipeline({ name: 'Deploy API', folderId: null });
    pipelines.savePipelineGraph(pipeline.id, {
      units: [{ id: 'unit-a', name: 'Build', position: { x: 0, y: 0 } }],
      edges: [],
    });
    commands.saveCommands('unit-a', [
      { id: 'cmd-local', type: 'shell', order: 0, config: { name: 'Local', script: 'echo local', serverId: null, shellType: 'cmd', onFailure: 'stop' } },
      { id: 'cmd-remote', type: 'shell', order: 1, config: { name: 'Remote', script: 'echo remote', serverId: 1, shellType: 'cmd', onFailure: 'stop' } },
    ]);

    await expect(engine.runPipeline(pipeline.id)).resolves.toMatchObject({ status: 'succeeded' });

    expect(localExecuted).toEqual(['Local']);
    expect(remoteExecuted).toEqual(['Remote']);
    expect(db.prepare('select command_name, stdout from command_results order by id').all()).toEqual([
      { command_name: 'Local', stdout: '' },
      { command_name: 'Remote', stdout: 'remote\n' },
    ]);
  });

  it('records executor connection errors as command failures', async () => {
    const { commands, db, engine, pipeline } = setup({
      execute: async () => {
        throw new Error('Authentication failed');
      },
    });
    commands.saveCommands('unit-a', [
      { id: 'cmd-remote', type: 'shell', order: 0, config: { name: 'Remote', script: 'echo remote', serverId: null, shellType: 'cmd', onFailure: 'stop' } },
    ]);

    const run = await engine.runPipeline(pipeline.id);

    expect(run.status).toBe('failed');
    expect(db.prepare('select command_name, status, stderr from command_results order by id').all()).toEqual([
      { command_name: 'Remote', status: 'failed', stderr: 'Authentication failed' },
    ]);
  });

  it('stores named outputs and substitutes them into downstream shell commands', async () => {
    const executedScripts: string[] = [];
    const { commands, db, engine, pipeline } = setup({
      execute: async (command, emit) => {
        if (command.type !== 'shell') {
          throw new Error('Expected shell command');
        }
        executedScripts.push(command.config.script);
        if (command.config.name === 'Build Image') {
          emit({ type: 'stdout', data: '::set-output name=tag::v1.2.3\n' });
        }
        return { exitCode: 0 };
      },
    });
    commands.saveCommands('unit-a', [
      { id: 'cmd-build', type: 'shell', order: 0, config: { name: 'Build Image', script: '::set-output name=tag::v1.2.3', serverId: null, shellType: 'cmd', onFailure: 'stop' } },
    ]);
    commands.saveCommands('unit-b', [
      { id: 'cmd-deploy', type: 'shell', order: 0, config: { name: 'Deploy', script: 'deploy {{Build.Build Image.tag}}', serverId: null, shellType: 'cmd', onFailure: 'stop' } },
    ]);

    await expect(engine.runPipeline(pipeline.id)).resolves.toMatchObject({ status: 'succeeded' });

    expect(executedScripts).toEqual(['::set-output name=tag::v1.2.3', 'deploy v1.2.3']);
    expect(db.prepare('select command_name, named_outputs from command_results order by id').all()).toEqual([
      { command_name: 'Build Image', named_outputs: '{"tag":"v1.2.3"}' },
      { command_name: 'Deploy', named_outputs: '{}' },
    ]);
  });

  it('substitutes run parameters into shell commands', async () => {
    const executedScripts: string[] = [];
    const { commands, engine, pipeline, pipelines } = setup({
      execute: async (command) => {
        if (command.type !== 'shell') {
          throw new Error('Expected shell command');
        }
        executedScripts.push(command.config.script);
        return { exitCode: 0 };
      },
    });
    pipelines.updateParameters(pipeline.id, [{ name: 'env', type: 'string', defaultValue: 'dev' }]);
    commands.saveCommands('unit-a', [
      { id: 'cmd-deploy', type: 'shell', order: 0, config: { name: 'Deploy', script: 'deploy {{params.env}}', serverId: null, shellType: 'cmd', onFailure: 'stop' } },
    ]);

    await expect(engine.runPipeline(pipeline.id, { env: 'prod' })).resolves.toMatchObject({ status: 'succeeded' });

    expect(executedScripts).toEqual(['deploy prod']);
  });

  it('runs forked branches in parallel and waits for both before a join unit', async () => {
    const started: string[] = [];
    const finished: string[] = [];
    const releases = new Map<string, () => void>();
    let resolveBranchesStarted!: () => void;
    const branchesStarted = new Promise<void>((resolve) => {
      resolveBranchesStarted = resolve;
    });
    const { commands, db, engine, pipeline, pipelines } = setup({
      execute: async (command) => {
        started.push(command.config.name);
        if (command.config.name === 'Branch A' || command.config.name === 'Branch B') {
          if (started.includes('Branch A') && started.includes('Branch B')) {
            resolveBranchesStarted();
          }
          await new Promise<void>((resolve) => releases.set(command.config.name, resolve));
        }
        finished.push(command.config.name);
        return { exitCode: 0 };
      },
    });
    pipelines.savePipelineGraph(pipeline.id, {
      units: [
        { id: 'unit-a', name: 'Start', position: { x: 0, y: 0 } },
        { id: 'unit-b', name: 'Left', position: { x: 200, y: -80 } },
        { id: 'unit-c', name: 'Right', position: { x: 200, y: 80 } },
        { id: 'unit-d', name: 'Join', position: { x: 400, y: 0 } },
      ],
      edges: [
        { source: 'unit-a', target: 'unit-b' },
        { source: 'unit-a', target: 'unit-c' },
        { source: 'unit-b', target: 'unit-d' },
        { source: 'unit-c', target: 'unit-d' },
      ],
    });
    commands.saveCommands('unit-a', [
      { id: 'cmd-start', type: 'shell', order: 0, config: { name: 'Start', script: 'start', serverId: null, shellType: 'cmd', onFailure: 'stop' } },
    ]);
    commands.saveCommands('unit-b', [
      { id: 'cmd-branch-a', type: 'shell', order: 0, config: { name: 'Branch A', script: 'a', serverId: null, shellType: 'cmd', onFailure: 'stop' } },
    ]);
    commands.saveCommands('unit-c', [
      { id: 'cmd-branch-b', type: 'shell', order: 0, config: { name: 'Branch B', script: 'b', serverId: null, shellType: 'cmd', onFailure: 'stop' } },
    ]);
    commands.saveCommands('unit-d', [
      { id: 'cmd-join', type: 'shell', order: 0, config: { name: 'Join', script: 'join', serverId: null, shellType: 'cmd', onFailure: 'stop' } },
    ]);

    const run = engine.runPipeline(pipeline.id);
    await branchesStarted;

    expect(finished).toEqual(['Start']);
    releases.get('Branch A')?.();
    releases.get('Branch B')?.();

    await expect(run).resolves.toMatchObject({ status: 'succeeded' });
    expect(started).toEqual(['Start', 'Branch A', 'Branch B', 'Join']);
    expect(db.prepare('select command_name, status from command_results order by id').all()).toEqual([
      { command_name: 'Start', status: 'succeeded' },
      { command_name: 'Branch A', status: 'succeeded' },
      { command_name: 'Branch B', status: 'succeeded' },
      { command_name: 'Join', status: 'succeeded' },
    ]);
  });

  it('lets sibling branches finish and skips join units after a branch failure', async () => {
    const executed: string[] = [];
    const { commands, db, engine, pipeline, pipelines } = setup({
      execute: async (command) => {
        executed.push(command.config.name);
        return { exitCode: command.config.name === 'Branch A' ? 1 : 0 };
      },
    });
    pipelines.savePipelineGraph(pipeline.id, {
      units: [
        { id: 'unit-a', name: 'Start', position: { x: 0, y: 0 } },
        { id: 'unit-b', name: 'Left', position: { x: 200, y: -80 } },
        { id: 'unit-c', name: 'Right', position: { x: 200, y: 80 } },
        { id: 'unit-d', name: 'Join', position: { x: 400, y: 0 } },
      ],
      edges: [
        { source: 'unit-a', target: 'unit-b' },
        { source: 'unit-a', target: 'unit-c' },
        { source: 'unit-b', target: 'unit-d' },
        { source: 'unit-c', target: 'unit-d' },
      ],
    });
    for (const [unitId, name] of [
      ['unit-a', 'Start'],
      ['unit-b', 'Branch A'],
      ['unit-c', 'Branch B'],
      ['unit-d', 'Join'],
    ] as const) {
      commands.saveCommands(unitId, [
        { id: `cmd-${unitId}`, type: 'shell', order: 0, config: { name, script: name, serverId: null, shellType: 'cmd', onFailure: 'stop' } },
      ]);
    }

    await expect(engine.runPipeline(pipeline.id)).resolves.toMatchObject({ status: 'failed' });

    expect(executed).toEqual(['Start', 'Branch A', 'Branch B']);
    expect(db.prepare('select command_name, status from command_results order by id').all()).toEqual([
      { command_name: 'Start', status: 'succeeded' },
      { command_name: 'Branch A', status: 'failed' },
      { command_name: 'Branch B', status: 'succeeded' },
      { command_name: 'Join', status: 'skipped' },
    ]);
  });

  it('lets all sibling branches finish and skips join units after multiple branch failures', async () => {
    const executed: string[] = [];
    const { commands, db, engine, pipeline, pipelines } = setup({
      execute: async (command) => {
        executed.push(command.config.name);
        return { exitCode: command.config.name.startsWith('Branch') ? 1 : 0 };
      },
    });
    pipelines.savePipelineGraph(pipeline.id, {
      units: [
        { id: 'unit-a', name: 'Start', position: { x: 0, y: 0 } },
        { id: 'unit-b', name: 'Left', position: { x: 200, y: -80 } },
        { id: 'unit-c', name: 'Right', position: { x: 200, y: 80 } },
        { id: 'unit-d', name: 'Join', position: { x: 400, y: 0 } },
      ],
      edges: [
        { source: 'unit-a', target: 'unit-b' },
        { source: 'unit-a', target: 'unit-c' },
        { source: 'unit-b', target: 'unit-d' },
        { source: 'unit-c', target: 'unit-d' },
      ],
    });
    for (const [unitId, name] of [
      ['unit-a', 'Start'],
      ['unit-b', 'Branch A'],
      ['unit-c', 'Branch B'],
      ['unit-d', 'Join'],
    ] as const) {
      commands.saveCommands(unitId, [
        { id: `cmd-${unitId}`, type: 'shell', order: 0, config: { name, script: name, serverId: null, shellType: 'cmd', onFailure: 'stop' } },
      ]);
    }

    await expect(engine.runPipeline(pipeline.id)).resolves.toMatchObject({ status: 'failed' });

    expect(executed).toEqual(['Start', 'Branch A', 'Branch B']);
    expect(db.prepare('select command_name, status from command_results order by id').all()).toEqual([
      { command_name: 'Start', status: 'succeeded' },
      { command_name: 'Branch A', status: 'failed' },
      { command_name: 'Branch B', status: 'failed' },
      { command_name: 'Join', status: 'skipped' },
    ]);
  });

  it('routes reusable shell commands through a named run session and closes sessions after the run', async () => {
    const sessionExecutions: Array<{ runId: number; sessionName: string; commandName: string }> = [];
    const closedRuns: number[] = [];
    const { commands, engine, pipeline, pipelines } = setup({
      execute: async () => {
        throw new Error('Expected session execution');
      },
      executeInSession: async (runId, sessionName, command) => {
        sessionExecutions.push({ runId, sessionName, commandName: command.config.name });
        return { exitCode: 0 };
      },
      closeSessions: async (runId) => {
        closedRuns.push(runId);
      },
    });
    pipelines.updateShellSessions(pipeline.id, ['deploy']);
    commands.saveCommands('unit-a', [
      {
        id: 'cmd-enter',
        type: 'shell',
        order: 0,
        config: {
          name: 'Enter directory',
          script: 'cd app',
          serverId: null,
          shellType: 'cmd',
          onFailure: 'stop',
          sessionName: 'deploy',
          reuseSession: true,
        },
      },
    ]);
    commands.saveCommands('unit-b', [
      {
        id: 'cmd-build',
        type: 'shell',
        order: 0,
        config: {
          name: 'Build',
          script: 'npm run build',
          serverId: null,
          shellType: 'cmd',
          onFailure: 'stop',
          sessionName: 'deploy',
          reuseSession: true,
        },
      },
    ]);

    const run = await engine.runPipeline(pipeline.id);

    expect(sessionExecutions).toEqual([
      { runId: run.id, sessionName: 'deploy', commandName: 'Enter directory' },
      { runId: run.id, sessionName: 'deploy', commandName: 'Build' },
    ]);
    expect(closedRuns).toEqual([run.id]);
  });

  it('routes transfer commands through the transfer executor and records the transfer summary', async () => {
    const progressEvents: Array<{ transferredBytes: number; totalBytes: number; percent: number }> = [];
    const db = new Database(':memory:');
    db.pragma('foreign_keys = on');
    migratePipelineSchema(db);
    const pipelines = new PipelineRepository(db);
    const commands = new CommandRepository(db);
    const engine = new PipelineEngine(
      db,
      pipelines,
      commands,
      {
        execute: async () => {
          throw new Error('Expected transfer executor');
        },
      },
      undefined,
      {
        execute: async (_command, emit) => {
          emit({ type: 'transfer-progress', transferredBytes: 5, totalBytes: 5, percent: 100 });
          return { exitCode: 0, summary: { fileCount: 1, totalBytes: 5, skippedCount: 0 } };
        },
      },
    );
    const pipeline = pipelines.createPipeline({ name: 'Deploy API', folderId: null });
    pipelines.savePipelineGraph(pipeline.id, {
      units: [{ id: 'unit-a', name: 'Upload', position: { x: 0, y: 0 } }],
      edges: [],
    });
    commands.saveCommands('unit-a', [
      {
        id: 'cmd-upload',
        type: 'transfer',
        order: 0,
        config: {
          name: 'Upload artifact',
          direction: 'upload',
          source: 'dist/*.zip',
          destination: '/srv/app',
          overwriteMode: 'overwrite',
          serverId: 1,
        },
      },
    ]);

    await expect(
      engine.runPipeline(pipeline.id, (event) => {
        if (event.type === 'transfer-progress') {
          progressEvents.push({
            transferredBytes: event.transferredBytes,
            totalBytes: event.totalBytes,
            percent: event.percent,
          });
        }
      }),
    ).resolves.toMatchObject({ status: 'succeeded' });

    expect(progressEvents).toEqual([{ transferredBytes: 5, totalBytes: 5, percent: 100 }]);
    expect(db.prepare('select command_name, status, stdout from command_results order by id').all()).toEqual([
      {
        command_name: 'Upload artifact',
        status: 'succeeded',
        stdout: '{"fileCount":1,"totalBytes":5,"skippedCount":0}\n',
      },
    ]);
  });

  it('starts a ready descendant before unrelated long-running sibling branches finish', async () => {
    const started: string[] = [];
    const finished: string[] = [];
    let releaseLongBranch!: () => void;
    let resolveDescendantStarted!: () => void;
    const descendantStarted = new Promise<void>((resolve) => {
      resolveDescendantStarted = resolve;
    });
    const { commands, engine, pipeline, pipelines } = setup({
      execute: async (command) => {
        started.push(command.config.name);
        if (command.config.name === 'Long Branch') {
          await new Promise<void>((resolve) => {
            releaseLongBranch = resolve;
          });
        }
        if (command.config.name === 'Short Child') {
          resolveDescendantStarted();
        }
        finished.push(command.config.name);
        return { exitCode: 0 };
      },
    });
    pipelines.savePipelineGraph(pipeline.id, {
      units: [
        { id: 'unit-a', name: 'Start', position: { x: 0, y: 0 } },
        { id: 'unit-b', name: 'Long', position: { x: 200, y: -80 } },
        { id: 'unit-c', name: 'Short', position: { x: 200, y: 80 } },
        { id: 'unit-d', name: 'Short Child', position: { x: 400, y: 80 } },
      ],
      edges: [
        { source: 'unit-a', target: 'unit-b' },
        { source: 'unit-a', target: 'unit-c' },
        { source: 'unit-c', target: 'unit-d' },
      ],
    });
    for (const [unitId, name] of [
      ['unit-a', 'Start'],
      ['unit-b', 'Long Branch'],
      ['unit-c', 'Short Branch'],
      ['unit-d', 'Short Child'],
    ] as const) {
      commands.saveCommands(unitId, [
        { id: `cmd-${unitId}`, type: 'shell', order: 0, config: { name, script: name, serverId: null, shellType: 'cmd', onFailure: 'stop' } },
      ]);
    }

    const run = engine.runPipeline(pipeline.id);
    await descendantStarted;

    expect(started).toEqual(['Start', 'Long Branch', 'Short Branch', 'Short Child']);
    expect(finished).toEqual(['Start', 'Short Branch', 'Short Child']);
    releaseLongBranch();
    await expect(run).resolves.toMatchObject({ status: 'succeeded' });
  });

  it('makes parallel branch outputs available to a join unit', async () => {
    const executedScripts: string[] = [];
    const { commands, engine, pipeline, pipelines } = setup({
      execute: async (command, emit) => {
        if (command.type !== 'shell') {
          throw new Error('Expected shell command');
        }
        executedScripts.push(command.config.script);
        if (command.config.name === 'Emit Left') {
          emit({ type: 'stdout', data: '::set-output name=left::L\n' });
        }
        if (command.config.name === 'Emit Right') {
          emit({ type: 'stdout', data: '::set-output name=right::R\n' });
        }
        return { exitCode: 0 };
      },
    });
    pipelines.savePipelineGraph(pipeline.id, {
      units: [
        { id: 'unit-a', name: 'Start', position: { x: 0, y: 0 } },
        { id: 'unit-b', name: 'Left', position: { x: 200, y: -80 } },
        { id: 'unit-c', name: 'Right', position: { x: 200, y: 80 } },
        { id: 'unit-d', name: 'Join', position: { x: 400, y: 0 } },
      ],
      edges: [
        { source: 'unit-a', target: 'unit-b' },
        { source: 'unit-a', target: 'unit-c' },
        { source: 'unit-b', target: 'unit-d' },
        { source: 'unit-c', target: 'unit-d' },
      ],
    });
    commands.saveCommands('unit-a', [
      { id: 'cmd-start', type: 'shell', order: 0, config: { name: 'Start', script: 'start', serverId: null, shellType: 'cmd', onFailure: 'stop' } },
    ]);
    commands.saveCommands('unit-b', [
      { id: 'cmd-left', type: 'shell', order: 0, config: { name: 'Emit Left', script: '::set-output name=left::L', serverId: null, shellType: 'cmd', onFailure: 'stop' } },
    ]);
    commands.saveCommands('unit-c', [
      { id: 'cmd-right', type: 'shell', order: 0, config: { name: 'Emit Right', script: '::set-output name=right::R', serverId: null, shellType: 'cmd', onFailure: 'stop' } },
    ]);
    commands.saveCommands('unit-d', [
      {
        id: 'cmd-join',
        type: 'shell',
        order: 0,
        config: {
          name: 'Join',
          script: 'join {{Left.Emit Left.left}} {{Right.Emit Right.right}}',
          serverId: null,
          shellType: 'cmd',
          onFailure: 'stop',
        },
      },
    ]);

    await expect(engine.runPipeline(pipeline.id)).resolves.toMatchObject({ status: 'succeeded' });

    expect(executedScripts).toEqual(['start', '::set-output name=left::L', '::set-output name=right::R', 'join L R']);
  });
});
