import { generateKeyPairSync } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { Server as SshServer } from 'ssh2';
import { afterEach, describe, expect, it } from 'vitest';
import { SshConnectionTester } from './sshConnectionTester';

const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
  format: 'pem',
  type: 'pkcs1',
});

let server: SshServer | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

async function startMockSshServer() {
  server = new SshServer({ hostKeys: [hostKey] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === 'deploy' && ctx.password === 'secret') {
        ctx.accept();
        return;
      }
      ctx.reject();
    });
    client.on('ready', () => client.end());
  });

  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

describe('SshConnectionTester', () => {
  it('reports a successful SSH handshake', async () => {
    const port = await startMockSshServer();
    const tester = new SshConnectionTester();

    await expect(
      tester.testConnection({
        host: '127.0.0.1',
        port,
        username: 'deploy',
        authMethod: 'password',
        password: 'secret',
        connectionTimeout: 5,
      }),
    ).resolves.toEqual({ ok: true });
  });

  it('returns a clear failure message for rejected credentials', async () => {
    const port = await startMockSshServer();
    const tester = new SshConnectionTester();

    const result = await tester.testConnection({
      host: '127.0.0.1',
      port,
      username: 'deploy',
      authMethod: 'password',
      password: 'wrong',
      connectionTimeout: 5,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected connection test to fail');
    }
    expect(result.message).toContain('Authentication failed');
  });
});
