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
    exportToFile: (pipelineId: number) => Promise<{ filePath: string | null }>;
    inspectImportFile: () => Promise<PipelineImportInspection>;
    importFromFile: (filePath: string, options: PipelineImportOptions) => Promise<PipelineRecord>;
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
    list: (pipelineId: number) => Promise<RunRecord[]>;
    snapshot: (runId: number) => Promise<RunSnapshotRecord>;
    onEvent: (callback: (event: ExecutionEvent) => void) => () => void;
  };
  settings: {
    get: () => Promise<AppSettings>;
    update: (settings: AppSettings) => Promise<AppSettings>;
    getRetention: () => Promise<RunRetentionSettings>;
    updateRetention: (settings: RunRetentionSettings) => Promise<RunRetentionSettings>;
  };
  notifications: {
    onRunCompleted: (callback: (notification: RunCompletionNotification) => void) => () => void;
  };
  fileBrowser: {
    listLocal: (path: string) => Promise<FileBrowserEntry[]>;
    createLocalDirectory: (parentPath: string, name: string) => Promise<void>;
    deleteLocal: (path: string) => Promise<void>;
    renameLocal: (path: string, newName: string) => Promise<void>;
    listRemote: (serverId: number, path: string) => Promise<FileBrowserEntry[]>;
    createRemoteDirectory: (serverId: number, parentPath: string, name: string) => Promise<void>;
    deleteRemote: (serverId: number, path: string) => Promise<void>;
    renameRemote: (serverId: number, path: string, newName: string) => Promise<void>;
    upload: (serverId: number, localPath: string, remoteDirectory: string) => Promise<void>;
    download: (serverId: number, remotePath: string, localDirectory: string) => Promise<void>;
    onTransferProgress: (callback: (progress: FileTransferProgress & { direction: 'upload' | 'download' }) => void) => () => void;
  };
}

export interface FileBrowserEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: string;
}

export interface FileTransferProgress {
  transferredBytes: number;
  totalBytes: number;
  percent: number;
}

export interface RunRetentionSettings {
  maxDays: number;
  maxCount: number;
}

export interface AppSettings {
  connectionPool: {
    idleTimeoutMinutes: number;
    maxConnections: number;
  };
  notifications: {
    inApp: boolean;
    toast: boolean;
  };
  retention: RunRetentionSettings;
  language: 'zh-CN' | 'en';
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

export interface PipelineImportInspection {
  filePath: string | null;
  duplicateName?: string | null;
  unknownServers?: string[];
  localServers?: string[];
}

export interface PipelineImportOptions {
  serverMappings?: Record<string, string>;
  duplicateName?: { mode: 'rename'; name: string } | { mode: 'overwrite' };
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
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
}

export interface RunSnapshotRecord {
  id: number;
  pipelineId: number;
  status: RunStatus;
  pipelineSnapshot: unknown;
  contextSnapshot: unknown;
}

export interface RunCompletionNotification {
  runId: number;
  pipelineId: number;
  pipelineName: string;
  status: Extract<RunStatus, 'succeeded' | 'failed' | 'cancelled'>;
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
