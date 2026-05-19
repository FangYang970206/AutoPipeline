import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { InMemoryCredentialStore } from '../server/credentialStore';
import type { ServerRecord } from '../server/types';
import { SshConnectionPool } from './sshConnectionPool';

class FakeClient extends EventEmitter {
  endCount = 0;
  connectConfig: unknown;

  connect(config: unknown) {
    this.connectConfig = config;
    queueMicrotask(() => this.emit('ready'));
  }

  end() {
    this.endCount += 1;
    this.emit('end');
  }
}

describe('SshConnectionPool', () => {
  it('creates one SSH connection per host, port, and username and reuses it', async () => {
    const credentials = new InMemoryCredentialStore();
    await credentials.setPassword(1, 'secret');
    const clients: FakeClient[] = [];
    const pool = new SshConnectionPool(credentials, {}, () => {
      const client = new FakeClient();
      clients.push(client);
      return client as never;
    });

    const first = await pool.acquire(server({ id: 1 }));
    const second = await pool.acquire(server({ id: 1 }));

    expect(first).toBe(second);
    expect(clients).toHaveLength(1);
    expect(clients[0].connectConfig).toMatchObject({ password: 'secret', host: 'example.com', port: 22 });
  });

  it('enforces the configured max connection limit', async () => {
    const credentials = new InMemoryCredentialStore();
    await credentials.setPassword(1, 'secret');
    await credentials.setPassword(2, 'secret');
    const pool = new SshConnectionPool(credentials, { maxConnections: 1 }, () => new FakeClient() as never);

    await pool.acquire(server({ id: 1, host: 'one.example.com' }));
    await expect(pool.acquire(server({ id: 2, host: 'two.example.com' }))).rejects.toThrow(
      'SSH connection pool limit reached',
    );
  });

  it('closes idle connections after the configured timeout', async () => {
    const credentials = new InMemoryCredentialStore();
    await credentials.setPassword(1, 'secret');
    const client = new FakeClient();
    const pool = new SshConnectionPool(credentials, { idleTimeoutMs: 10 }, () => client as never);

    await pool.acquire(server({ id: 1 }));
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(client.endCount).toBe(1);
  });

  it('applies updated pool settings to connection limits and idle timers', async () => {
    const credentials = new InMemoryCredentialStore();
    await credentials.setPassword(1, 'secret');
    await credentials.setPassword(2, 'secret');
    const client = new FakeClient();
    const pool = new SshConnectionPool(credentials, { idleTimeoutMs: 1000, maxConnections: 2 }, () => client as never);

    await pool.acquire(server({ id: 1, host: 'one.example.com' }));
    pool.updateOptions({ idleTimeoutMs: 10, maxConnections: 1 });

    await expect(pool.acquire(server({ id: 2, host: 'two.example.com' }))).rejects.toThrow(
      'SSH connection pool limit reached',
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(client.endCount).toBe(1);
  });
});

function server(overrides: Partial<ServerRecord>): ServerRecord {
  return {
    id: 1,
    displayName: 'Prod',
    host: 'example.com',
    port: 22,
    username: 'deploy',
    authMethod: 'password',
    keyPath: null,
    connectionTimeout: 5,
    keepaliveInterval: 15,
    defaultDirectory: null,
    notes: '',
    createdAt: '2026-05-18T00:00:00Z',
    updatedAt: '2026-05-18T00:00:00Z',
    ...overrides,
  };
}
