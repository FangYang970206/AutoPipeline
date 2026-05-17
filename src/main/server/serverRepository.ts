import type { Database } from 'better-sqlite3';
import type { CredentialStore } from './credentialStore.js';
import type { ServerInput, ServerRecord } from './types.js';

interface PipelineReferenceProvider {
  findPipelineNamesUsingServer(serverId: number): string[];
}

interface ServerRow {
  id: number;
  display_name: string;
  host: string;
  port: number;
  username: string;
  auth_method: 'password' | 'key';
  key_path: string | null;
  connection_timeout: number;
  keepalive_interval: number;
  default_directory: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export class ServerInUseError extends Error {
  constructor(readonly pipelineNames: string[]) {
    super(`Server is used by pipelines: ${pipelineNames.join(', ')}`);
    this.name = 'ServerInUseError';
  }
}

export class ServerRepository {
  constructor(
    private readonly db: Database,
    private readonly credentials: CredentialStore,
    private readonly pipelineReferences: PipelineReferenceProvider,
  ) {}

  list(): ServerRecord[] {
    return this.db
      .prepare(
        `select id, display_name, host, port, username, auth_method, key_path,
                connection_timeout, keepalive_interval, default_directory, notes,
                created_at, updated_at
           from servers
          order by display_name collate nocase`,
      )
      .all()
      .map((row) => mapServerRow(row as ServerRow));
  }

  async create(input: ServerInput): Promise<ServerRecord> {
    validateServerInput(input);

    const result = this.db
      .prepare(
        `insert into servers (
          display_name, host, port, username, auth_method, key_path,
          connection_timeout, keepalive_interval, default_directory, notes
        ) values (
          @displayName, @host, @port, @username, @authMethod, @keyPath,
          @connectionTimeout, @keepaliveInterval, @defaultDirectory, @notes
        )`,
      )
      .run({
        displayName: input.displayName.trim(),
        host: input.host.trim(),
        port: input.port,
        username: input.username.trim(),
        authMethod: input.authMethod,
        keyPath: input.keyPath?.trim() || null,
        connectionTimeout: input.connectionTimeout,
        keepaliveInterval: input.keepaliveInterval,
        defaultDirectory: input.defaultDirectory?.trim() || null,
        notes: input.notes?.trim() || '',
      });

    const id = Number(result.lastInsertRowid);
    await this.storeCredentials(id, input);
    return this.get(id);
  }

  async update(id: number, input: ServerInput): Promise<ServerRecord> {
    validateServerInput(input);

    this.db
      .prepare(
        `update servers
            set display_name = @displayName,
                host = @host,
                port = @port,
                username = @username,
                auth_method = @authMethod,
                key_path = @keyPath,
                connection_timeout = @connectionTimeout,
                keepalive_interval = @keepaliveInterval,
                default_directory = @defaultDirectory,
                notes = @notes,
                updated_at = current_timestamp
          where id = @id`,
      )
      .run({
        id,
        displayName: input.displayName.trim(),
        host: input.host.trim(),
        port: input.port,
        username: input.username.trim(),
        authMethod: input.authMethod,
        keyPath: input.keyPath?.trim() || null,
        connectionTimeout: input.connectionTimeout,
        keepaliveInterval: input.keepaliveInterval,
        defaultDirectory: input.defaultDirectory?.trim() || null,
        notes: input.notes?.trim() || '',
      });

    await this.credentials.deletePassword(id);
    await this.credentials.deleteKeyPassphrase(id);
    await this.storeCredentials(id, input);
    return this.get(id);
  }

  get(id: number): ServerRecord {
    const row = this.db.prepare('select * from servers where id = ?').get(id) as ServerRow | undefined;
    if (!row) {
      throw new Error(`Server not found: ${id}`);
    }
    return mapServerRow(row);
  }

  async delete(id: number): Promise<void> {
    const pipelineNames = this.pipelineReferences.findPipelineNamesUsingServer(id);
    if (pipelineNames.length > 0) {
      throw new ServerInUseError(pipelineNames);
    }

    this.db.prepare('delete from servers where id = ?').run(id);
    await this.credentials.deletePassword(id);
    await this.credentials.deleteKeyPassphrase(id);
  }

  private async storeCredentials(id: number, input: ServerInput) {
    if (input.authMethod === 'password' && input.password) {
      await this.credentials.setPassword(id, input.password);
    }
    if (input.authMethod === 'key' && input.keyPassphrase) {
      await this.credentials.setKeyPassphrase(id, input.keyPassphrase);
    }
  }
}

function validateServerInput(input: ServerInput) {
  if (!input.displayName.trim()) {
    throw new Error('Display name is required');
  }
  if (!input.host.trim()) {
    throw new Error('Host is required');
  }
  if (!input.username.trim()) {
    throw new Error('Username is required');
  }
  if (!Number.isInteger(input.port) || input.port <= 0 || input.port > 65535) {
    throw new Error('Port must be between 1 and 65535');
  }
}

function mapServerRow(row: ServerRow): ServerRecord {
  return {
    id: row.id,
    displayName: row.display_name,
    host: row.host,
    port: row.port,
    username: row.username,
    authMethod: row.auth_method,
    keyPath: row.key_path,
    connectionTimeout: row.connection_timeout,
    keepaliveInterval: row.keepalive_interval,
    defaultDirectory: row.default_directory,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
