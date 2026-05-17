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

declare global {
  interface Window {
    autoPipeline?: AutoPipelineApi;
  }
}
