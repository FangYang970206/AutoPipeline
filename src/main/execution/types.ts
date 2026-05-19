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
  | ({ runId: number; commandId: string } & CommandOutputEvent);

export type CommandOutputEvent =
  | { type: 'stdout' | 'stderr'; data: string }
  | { type: 'transfer-progress'; transferredBytes: number; totalBytes: number; percent: number };

export interface CommandExecutionResult {
  exitCode: number;
  summary?: unknown;
}

export interface LocalCommandExecutor {
  execute: (
    command: CommandRecord,
    emit: (event: CommandOutputEvent) => void,
  ) => Promise<CommandExecutionResult>;
  executeInSession?: (
    runId: number,
    sessionName: string,
    command: CommandRecord,
    emit: (event: CommandOutputEvent) => void,
  ) => Promise<CommandExecutionResult>;
  closeSessions?: (runId: number) => Promise<void>;
}
