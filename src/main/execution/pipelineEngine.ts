import type { Database } from 'better-sqlite3';
import type { CommandRepository } from '../command/commandRepository.js';
import type { CommandRecord } from '../command/types.js';
import type { PipelineRepository } from '../pipeline/pipelineRepository.js';
import { parseNamedOutputs, storeOutputs, substituteTemplate, type NamedOutputs, type OutputContext } from './namedOutputs.js';
import type { ExecutionEvent, LocalCommandExecutor, RunRecord, RunStatus } from './types.js';

export type { LocalCommandExecutor } from './types.js';

export class PipelineAlreadyRunningError extends Error {
  constructor(pipelineId: number) {
    super(`Pipeline ${pipelineId} is already running`);
    this.name = 'PipelineAlreadyRunningError';
  }
}

export class PipelineEngine {
  private readonly runningPipelineIds = new Set<number>();
  private readonly runningRuns = new Map<number, { controller: AbortController; pipelineId: number }>();

  constructor(
    private readonly db: Database,
    private readonly pipelines: PipelineRepository,
    private readonly commands: CommandRepository,
    private readonly localExecutor: LocalCommandExecutor,
    private readonly remoteExecutor?: LocalCommandExecutor,
    private readonly transferExecutor?: LocalCommandExecutor,
  ) {}

  async runPipeline(
    pipelineId: number,
    parametersOrEmit: Record<string, unknown> | ((event: ExecutionEvent) => void) = {},
    maybeEmit: (event: ExecutionEvent) => void = () => {},
  ): Promise<RunRecord> {
    const parameters = typeof parametersOrEmit === 'function' ? {} : parametersOrEmit;
    const emit = typeof parametersOrEmit === 'function' ? parametersOrEmit : maybeEmit;
    return this.runPipelineInternal(pipelineId, parameters, emit);
  }

  async cancelRun(runId: number) {
    const running = this.runningRuns.get(runId);
    if (!running) {
      return;
    }
    running.controller.abort();
  }

  async resumeRun(
    failedRunId: number,
    emit: (event: ExecutionEvent) => void = () => {},
  ): Promise<RunRecord> {
    const failedRun = this.db
      .prepare('select id, pipeline_id as pipelineId, status, parameters, context_snapshot as contextSnapshot from runs where id = ?')
      .get(failedRunId) as { id: number; pipelineId: number; status: RunStatus; parameters: string; contextSnapshot: string } | undefined;
    if (!failedRun) {
      throw new Error(`Run ${failedRunId} was not found`);
    }
    if (failedRun.status !== 'failed') {
      throw new Error('Only failed runs can be resumed');
    }
    const succeededCommandIds = new Set(
      (this.db
        .prepare("select command_id as commandId from command_results where run_id = ? and status = 'succeeded' and command_id is not null")
        .all(failedRunId) as Array<{ commandId: string }>).map((row) => row.commandId),
    );
    return this.runPipelineInternal(
      failedRun.pipelineId,
      parseJsonObject(failedRun.parameters),
      emit,
      {
        initialOutputContext: parseJsonObject(failedRun.contextSnapshot) as OutputContext,
        skipCommandIds: succeededCommandIds,
      },
    );
  }

  private async runPipelineInternal(
    pipelineId: number,
    parameters: Record<string, unknown>,
    emit: (event: ExecutionEvent) => void,
    resume?: { initialOutputContext: OutputContext; skipCommandIds: Set<string> },
  ): Promise<RunRecord> {
    if (this.runningPipelineIds.has(pipelineId)) {
      throw new PipelineAlreadyRunningError(pipelineId);
    }
    this.runningPipelineIds.add(pipelineId);
    const controller = new AbortController();
    const runId = this.createRun(pipelineId, parameters);
    this.runningRuns.set(runId, { controller, pipelineId });
    emit({ type: 'run-status', runId, status: 'pending' });
    this.markRunRunning(runId);
    emit({ type: 'run-status', runId, status: 'running' });
    const started = Date.now();

    try {
      const graph = this.pipelines.getPipelineGraph(pipelineId);
      const unitNames = new Map(graph.units.map((unit) => [unit.id, unit.name]));
      const schedule = buildSchedule(graph.units.map((unit) => unit.id), graph.edges);
      let outputContext: OutputContext = resume?.initialOutputContext ?? {};
      let runStatus: RunStatus = 'succeeded';
      const unitStatuses = new Map<string, UnitExecutionStatus>();

      const runningUnits = new Map<string, Promise<UnitExecutionResult>>();
      const startUnit = (unitId: string) => {
        const inputContext = outputContext;
        const runUnit = hasFailedPredecessor(unitId, schedule.predecessors, unitStatuses)
          ? Promise.resolve(this.skipUnit(runId, unitId, emit))
          : this.executeUnit(runId, unitId, unitNames.get(unitId) ?? unitId, inputContext, parameters, emit, controller.signal, resume?.skipCommandIds ?? new Set());
        runningUnits.set(unitId, runUnit);
      };

      for (const unitId of schedule.ready) {
        startUnit(unitId);
      }

      while (runningUnits.size > 0) {
        const result = await Promise.race(runningUnits.values());
        runningUnits.delete(result.unitId);
        unitStatuses.set(result.unitId, result.status);
        outputContext = mergeOutputContext(outputContext, result.outputs);
        if (controller.signal.aborted) {
          runStatus = 'cancelled';
        }
        if (result.status === 'failed' || result.status === 'skipped') {
          runStatus = controller.signal.aborted ? 'cancelled' : 'failed';
        }
        if (controller.signal.aborted) {
          continue;
        }
        for (const nextUnit of schedule.successors.get(result.unitId) ?? []) {
          schedule.remainingPredecessors.set(nextUnit, schedule.remainingPredecessors.get(nextUnit)! - 1);
          if (schedule.remainingPredecessors.get(nextUnit) === 0) {
            startUnit(nextUnit);
          }
        }
      }

      this.finishRun(runId, runStatus, started, outputContext);
      emit({ type: 'run-status', runId, status: runStatus });
      return { id: runId, pipelineId, status: runStatus, parameters };
    } finally {
      await Promise.allSettled([this.localExecutor.closeSessions?.(runId), this.remoteExecutor?.closeSessions?.(runId)]);
      this.runningRuns.delete(runId);
      this.runningPipelineIds.delete(pipelineId);
    }
  }

  private async executeUnit(
    runId: number,
    unitId: string,
    unitName: string,
    inputContext: OutputContext,
    parameters: Record<string, unknown>,
    emit: (event: ExecutionEvent) => void,
    signal: AbortSignal,
    skipCommandIds: Set<string>,
  ): Promise<UnitExecutionResult> {
    const unitCommands = this.commands.listCommands(unitId);
    let outputContext: OutputContext = {};
    let skipRestOfUnit = false;
    for (const command of unitCommands) {
      if (signal.aborted) {
        return { unitId, status: 'failed', outputs: outputContext };
      }
      if (skipRestOfUnit) {
        this.recordCommandResult(runId, command, 'skipped', '', '', null, 0);
        emit({ type: 'command-status', runId, commandId: command.id, status: 'skipped' });
        continue;
      }
      if (skipCommandIds.has(command.id)) {
        this.recordCommandResult(runId, command, 'skipped', '', '', null, 0);
        emit({ type: 'command-status', runId, commandId: command.id, status: 'skipped' });
        continue;
      }

      const result = await this.executeCommand(
        runId,
        command,
        mergeOutputContext(inputContext, outputContext),
        parameters,
        emit,
        signal,
      );
      outputContext = storeOutputs(outputContext, unitName, command.config.name, result.outputs);
      if (signal.aborted) {
        return { unitId, status: 'failed', outputs: outputContext };
      }
      if (result.exitCode !== 0) {
        const onFailure = command.type === 'shell' ? command.config.onFailure : 'stop';
        if (onFailure === 'stop') {
          this.skipRemainingCommands(runId, unitCommands, command.id, emit);
          return { unitId, status: 'failed', outputs: outputContext };
        }
        if (onFailure === 'skip_unit') {
          skipRestOfUnit = true;
        }
      }
    }

    return { unitId, status: 'succeeded', outputs: outputContext };
  }

  private async executeCommand(
    runId: number,
    originalCommand: CommandRecord,
    outputContext: OutputContext,
    parameters: Record<string, unknown>,
    emit: (event: ExecutionEvent) => void,
    signal: AbortSignal,
  ) {
    const started = Date.now();
    let command = originalCommand;
    let stdout = '';
    let stderr = '';
    emit({ type: 'command-status', runId, commandId: command.id, status: 'pending' });
    emit({ type: 'command-status', runId, commandId: command.id, status: 'running' });
    try {
      command = prepareCommand(originalCommand, outputContext, parameters);
    } catch (error) {
      stderr = error instanceof Error ? error.message : 'Template substitution failed';
      emit({ type: 'stderr', runId, commandId: command.id, data: stderr });
      this.recordCommandResult(runId, command, 'failed', stdout, stderr, 1, Date.now() - started);
      emit({ type: 'command-status', runId, commandId: command.id, status: 'failed' });
      return { exitCode: 1, outputs: {} };
    }
    const executor =
      command.type === 'transfer'
        ? this.transferExecutor
        : command.type === 'shell' && command.config.serverId !== null && this.remoteExecutor
          ? this.remoteExecutor
          : this.localExecutor;
    if (!executor) {
      stderr = command.type === 'transfer' ? 'Transfer command execution is not configured' : 'Command execution is not configured';
      emit({ type: 'stderr', runId, commandId: command.id, data: stderr });
      this.recordCommandResult(runId, command, 'failed', stdout, stderr, 1, Date.now() - started);
      emit({ type: 'command-status', runId, commandId: command.id, status: 'failed' });
      return { exitCode: 1, outputs: {} };
    }
    const execute =
      command.type === 'shell' && command.config.reuseSession && command.config.sessionName
        ? (emitOutput: Parameters<LocalCommandExecutor['execute']>[1]) =>
            executor.executeInSession
              ? executor.executeInSession(runId, command.config.sessionName!, command, emitOutput, { runId, signal })
              : executor.execute(command, emitOutput, { runId, signal })
        : command.type === 'shell' && command.config.reuseSession
          ? () => {
              throw new Error('Shell session name is required when reuseSession is enabled');
            }
        : (emitOutput: Parameters<LocalCommandExecutor['execute']>[1]) => executor.execute(command, emitOutput, { runId, signal });
    const result = await Promise.resolve()
      .then(() =>
        execute((streamEvent) => {
          if (streamEvent.type === 'stdout') {
            stdout += streamEvent.data;
          } else if (streamEvent.type === 'stderr') {
            stderr += streamEvent.data;
          }
          emit({ ...streamEvent, runId, commandId: command.id });
        }),
      )
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Command execution failed';
        stderr += message;
        emit({ type: 'stderr', runId, commandId: command.id, data: message });
        return { exitCode: 1, summary: undefined };
      });
    const status = result.exitCode === 0 ? 'succeeded' : 'failed';
    if (result.summary) {
      stdout += `${JSON.stringify(result.summary)}\n`;
    }
    const outputs = parseNamedOutputs(stdout);
    this.recordCommandResult(runId, command, status, stdout, stderr, result.exitCode, Date.now() - started, outputs);
    emit({ type: 'command-status', runId, commandId: command.id, status });
    return { ...result, outputs };
  }

  private createRun(pipelineId: number, parameters: Record<string, unknown>) {
    const result = this.db
      .prepare("insert into runs (pipeline_id, status, started_at, parameters) values (?, 'pending', current_timestamp, ?)")
      .run(pipelineId, JSON.stringify(parameters));
    return Number(result.lastInsertRowid);
  }

  private markRunRunning(runId: number) {
    this.db.prepare("update runs set status = 'running' where id = ?").run(runId);
  }

  private finishRun(runId: number, status: RunStatus, started: number, contextSnapshot: OutputContext) {
    this.db
      .prepare('update runs set status = ?, completed_at = current_timestamp, duration_ms = ?, context_snapshot = ? where id = ?')
      .run(status, Date.now() - started, JSON.stringify(contextSnapshot), runId);
  }

  private recordCommandResult(
    runId: number,
    command: CommandRecord,
    status: 'succeeded' | 'failed' | 'skipped',
    stdout: string,
    stderr: string,
    exitCode: number | null,
    durationMs: number,
    outputs: NamedOutputs = {},
  ) {
    this.db
      .prepare(
        `insert into command_results (
          run_id, command_id, unit_id, command_name, status, stdout, stderr, exit_code,
          named_outputs, started_at, completed_at, duration_ms
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, current_timestamp, current_timestamp, ?)`,
      )
      .run(
        runId,
        command.id,
        command.unitId,
        command.config.name,
        status,
        stdout,
        stderr,
        exitCode,
        JSON.stringify(outputs),
        durationMs,
      );
  }

  private skipRemainingCommands(
    runId: number,
    unitCommands: CommandRecord[],
    failedCommandId: string,
    emit: (event: ExecutionEvent) => void,
  ) {
    let afterFailedCommand = false;
    for (const command of unitCommands) {
      if (command.id === failedCommandId) {
        afterFailedCommand = true;
        continue;
      }
      if (afterFailedCommand) {
        this.recordCommandResult(runId, command, 'skipped', '', '', null, 0);
        emit({ type: 'command-status', runId, commandId: command.id, status: 'skipped' });
      }
    }
  }

  private skipUnit(runId: number, unitId: string, emit: (event: ExecutionEvent) => void): UnitExecutionResult {
    for (const command of this.commands.listCommands(unitId)) {
      this.recordCommandResult(runId, command, 'skipped', '', '', null, 0);
      emit({ type: 'command-status', runId, commandId: command.id, status: 'skipped' });
    }
    return { unitId, status: 'skipped', outputs: {} };
  }
}

type UnitExecutionStatus = 'succeeded' | 'failed' | 'skipped';

interface UnitExecutionResult {
  unitId: string;
  status: UnitExecutionStatus;
  outputs: OutputContext;
}

function prepareCommand(command: CommandRecord, context: OutputContext, parameters: Record<string, unknown>): CommandRecord {
  if (command.type !== 'shell') {
    return command;
  }
  return {
    ...command,
    config: {
      ...command.config,
      script: substituteTemplate(command.config.script, context, parameters),
    },
  };
}

function buildSchedule(nodes: string[], edges: Array<{ source: string; target: string }>) {
  const remainingPredecessors = new Map(nodes.map((node) => [node, 0]));
  const predecessors = new Map(nodes.map((node) => [node, [] as string[]]));
  const successors = new Map(nodes.map((node) => [node, [] as string[]]));
  for (const edge of edges) {
    remainingPredecessors.set(edge.target, (remainingPredecessors.get(edge.target) ?? 0) + 1);
    predecessors.get(edge.target)?.push(edge.source);
    successors.get(edge.source)?.push(edge.target);
  }

  return {
    predecessors,
    ready: nodes.filter((node) => (remainingPredecessors.get(node) ?? 0) === 0),
    remainingPredecessors,
    successors,
  };
}

function hasFailedPredecessor(
  unitId: string,
  predecessors: Map<string, string[]>,
  unitStatuses: Map<string, UnitExecutionStatus>,
) {
  return (predecessors.get(unitId) ?? []).some((predecessor) => {
    const status = unitStatuses.get(predecessor);
    return status === 'failed' || status === 'skipped';
  });
}

function mergeOutputContext(left: OutputContext, right: OutputContext): OutputContext {
  const merged: OutputContext = { ...left };
  for (const [unitName, commands] of Object.entries(right)) {
    merged[unitName] = { ...(merged[unitName] ?? {}), ...commands };
  }
  return merged;
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
