export type ViewId = 'pipelines' | 'fileBrowser' | 'servers' | 'settings';

export interface AutoPipelineApi {
  app: {
    getVersion: () => Promise<string>;
    ping: () => Promise<'pong'>;
  };
  servers: {
    list: () => Promise<ServerRecord[]>;
    create: (input: ServerInput) => Promise<ServerRecord>;
    update: (id: number, input: ServerInput) => Promise<ServerRecord>;
    delete: (id: number) => Promise<void>;
    testConnection: (input: ServerInput) => Promise<ConnectionTestResult>;
  };
  pipelines: {
    tree: () => Promise<PipelineTreeFolder[]>;
    search: (query: string) => Promise<PipelineTreeFolder[]>;
    createFolder: (input: { name: string; parentId: number | null }) => Promise<FolderRecord>;
    renameFolder: (id: number, name: string) => Promise<FolderRecord>;
    deleteFolder: (id: number) => Promise<void>;
    createPipeline: (input: { name: string; folderId: number | null }) => Promise<PipelineRecord>;
    renamePipeline: (id: number, name: string) => Promise<PipelineRecord>;
    getPipelineDeleteImpact: (id: number) => Promise<{ runCount: number }>;
    deletePipeline: (id: number) => Promise<void>;
    getGraph: (pipelineId: number) => Promise<PipelineGraph>;
    saveGraph: (pipelineId: number, graph: PipelineGraph) => Promise<void>;
    updateParameters: (pipelineId: number, parameters: PipelineParameter[]) => Promise<PipelineRecord>;
    updateShellSessions: (pipelineId: number, shellSessions: string[]) => Promise<PipelineRecord>;
  };
  commands: {
    list: (unitId: string) => Promise<CommandRecord[]>;
    save: (unitId: string, commands: CommandInput[]) => Promise<void>;
    delete: (id: string) => Promise<void>;
    reorder: (unitId: string, orderedIds: string[]) => Promise<void>;
  };
  runs: {
    start: (pipelineId: number, parameters?: Record<string, unknown>) => Promise<RunRecord>;
    cancel: (runId: number) => Promise<void>;
    resume: (runId: number) => Promise<RunRecord>;
    onEvent: (callback: (event: ExecutionEvent) => void) => () => void;
  };
}

export type ServerAuthMethod = 'password' | 'key';

export interface ServerRecord {
  id: number;
  displayName: string;
  host: string;
  port: number;
  username: string;
  authMethod: ServerAuthMethod;
  keyPath: string | null;
  connectionTimeout: number;
  keepaliveInterval: number;
  defaultDirectory: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServerInput {
  displayName: string;
  host: string;
  port: number;
  username: string;
  authMethod: ServerAuthMethod;
  password?: string;
  keyPath?: string;
  keyPassphrase?: string;
  connectionTimeout: number;
  keepaliveInterval: number;
  defaultDirectory?: string;
  notes?: string;
}

export type ConnectionTestResult = { ok: true } | { ok: false; message: string };

export interface FolderRecord {
  id: number;
  name: string;
  parentId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineRecord {
  id: number;
  name: string;
  folderId: number | null;
  dagEdges: unknown[];
  parameters: PipelineParameter[];
  shellSessions: string[];
  createdAt: string;
  updatedAt: string;
}

export type PipelineParameterType = 'string' | 'number' | 'boolean' | 'select';

export interface PipelineParameter {
  name: string;
  type: PipelineParameterType;
  defaultValue: string | number | boolean;
  options?: string[];
}

export interface PipelineTreeFolder extends FolderRecord {
  folders: PipelineTreeFolder[];
  pipelines: PipelineRecord[];
}

export interface ExecutionUnitRecord {
  id: string;
  name: string;
  position: { x: number; y: number };
}

export interface PipelineGraph {
  units: ExecutionUnitRecord[];
  edges: Array<{ source: string; target: string }>;
}

export type CommandType = 'shell' | 'transfer';
export type ShellFailureMode = 'stop' | 'continue' | 'skip_unit';

export interface ShellCommandConfig {
  name: string;
  script: string;
  serverId: number | null;
  shellType: 'powershell' | 'cmd';
  timeout?: number;
  onFailure: ShellFailureMode;
  sessionName?: string | null;
  reuseSession?: boolean;
}

export interface TransferCommandConfig {
  name: string;
  direction: 'upload' | 'download';
  source: string;
  destination: string;
  overwriteMode: 'overwrite' | 'skip' | 'error';
  serverId: number | null;
}

export type CommandConfig = ShellCommandConfig | TransferCommandConfig;

export interface ShellCommandRecord {
  id: string;
  unitId: string;
  order: number;
  type: 'shell';
  config: ShellCommandConfig;
}

export interface TransferCommandRecord {
  id: string;
  unitId: string;
  order: number;
  type: 'transfer';
  config: TransferCommandConfig;
}

export type CommandRecord = ShellCommandRecord | TransferCommandRecord;
export type CommandInput = Omit<ShellCommandRecord, 'unitId'> | Omit<TransferCommandRecord, 'unitId'>;

export type RunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type CommandExecutionStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface RunRecord {
  id: number;
  pipelineId: number;
  status: RunStatus;
  parameters?: Record<string, unknown>;
}

export type ExecutionEvent =
  | { type: 'run-status'; runId: number; status: RunStatus }
  | { type: 'command-status'; runId: number; commandId: string; status: CommandExecutionStatus }
  | { type: 'stdout' | 'stderr'; runId: number; commandId: string; data: string }
  | { type: 'transfer-progress'; runId: number; commandId: string; transferredBytes: number; totalBytes: number; percent: number };

declare global {
  interface Window {
    autoPipeline?: AutoPipelineApi;
  }
}
