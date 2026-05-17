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
  createdAt: string;
  updatedAt: string;
}

export interface PipelineTreeFolder extends FolderRecord {
  folders: PipelineTreeFolder[];
  pipelines: PipelineRecord[];
}

declare global {
  interface Window {
    autoPipeline?: AutoPipelineApi;
  }
}
