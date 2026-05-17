import { readFile } from 'node:fs/promises';
import { Client, type ConnectConfig } from 'ssh2';
import type { CredentialStore } from '../server/credentialStore.js';
import type { ServerRecord } from '../server/types.js';

export interface PooledSshConnection {
  client: Client;
  key: string;
}

export interface SshConnectionPoolOptions {
  idleTimeoutMs?: number;
  maxConnections?: number;
}

type ClientFactory = () => Client;

interface PoolEntry {
  connection: PooledSshConnection;
  idleTimer?: ReturnType<typeof setTimeout>;
}

export class SshConnectionPool {
  private readonly entries = new Map<string, PoolEntry>();
  private readonly idleTimeoutMs: number;
  private readonly maxConnections: number;

  constructor(
    private readonly credentials: CredentialStore,
    options: SshConnectionPoolOptions = {},
    private readonly createClient: ClientFactory = () => new Client(),
  ) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? 5 * 60 * 1000;
    this.maxConnections = options.maxConnections ?? 10;
  }

  async acquire(server: ServerRecord): Promise<PooledSshConnection> {
    const key = serverKey(server);
    const existing = this.entries.get(key);
    if (existing) {
      this.refreshIdleTimer(key, existing);
      return existing.connection;
    }
    if (this.entries.size >= this.maxConnections) {
      throw new Error(`SSH connection pool limit reached (${this.maxConnections})`);
    }

    const client = this.createClient();
    const connection = await connectClient(client, await this.buildConnectConfig(server));
    const entry: PoolEntry = { connection: { client: connection, key } };
    this.entries.set(key, entry);
    this.refreshIdleTimer(key, entry);
    client.on('close', () => this.entries.delete(key));
    client.on('end', () => this.entries.delete(key));
    return entry.connection;
  }

  destroyAll() {
    for (const [key, entry] of this.entries) {
      clearTimeout(entry.idleTimer);
      entry.connection.client.end();
      this.entries.delete(key);
    }
  }

  private refreshIdleTimer(key: string, entry: PoolEntry) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      entry.connection.client.end();
      this.entries.delete(key);
    }, this.idleTimeoutMs);
    entry.idleTimer.unref?.();
  }

  private async buildConnectConfig(server: ServerRecord): Promise<ConnectConfig> {
    const password = server.authMethod === 'password' ? await this.credentials.getPassword(server.id) : undefined;
    const passphrase = server.authMethod === 'key' ? await this.credentials.getKeyPassphrase(server.id) : undefined;
    const privateKey = server.authMethod === 'key' && server.keyPath ? await readFile(server.keyPath, 'utf8') : undefined;
    return {
      host: server.host,
      port: server.port,
      username: server.username,
      password: password ?? undefined,
      privateKey,
      passphrase: passphrase ?? undefined,
      readyTimeout: server.connectionTimeout * 1000,
      keepaliveInterval: server.keepaliveInterval * 1000,
    };
  }
}

function connectClient(client: Client, config: ConnectConfig) {
  return new Promise<Client>((resolve, reject) => {
    const cleanup = () => {
      client.off('ready', onReady);
      client.off('error', onError);
    };
    const onReady = () => {
      cleanup();
      resolve(client);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(new Error(normalizeSshError(error)));
    };
    client.once('ready', onReady);
    client.once('error', onError);
    client.connect(config);
  });
}

function normalizeSshError(error: Error) {
  if (error.message.toLowerCase().includes('authentication')) {
    return 'Authentication failed';
  }
  return error.message || 'SSH connection failed';
}

function serverKey(server: Pick<ServerRecord, 'host' | 'port' | 'username'>) {
  return `${server.host}:${server.port}:${server.username}`;
}
