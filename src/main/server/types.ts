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
