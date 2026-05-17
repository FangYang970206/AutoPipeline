import type { CommandRecord } from '../command/types.js';

export type RunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type CommandExecutionStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface RunRecord {
  id: number;
  pipelineId: number;
  status: RunStatus;
}

export type ExecutionEvent =
  | { type: 'run-status'; runId: number; status: RunStatus }
  | { type: 'command-status'; runId: number; commandId: string; status: CommandExecutionStatus }
  | { type: 'stdout' | 'stderr'; runId: number; commandId: string; data: string };

export interface CommandExecutionResult {
  exitCode: number;
}

export interface LocalCommandExecutor {
  execute: (
    command: CommandRecord,
    emit: (event: Omit<Extract<ExecutionEvent, { type: 'stdout' | 'stderr' }>, 'runId' | 'commandId'>) => void,
  ) => Promise<CommandExecutionResult>;
}
