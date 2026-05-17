import { Client } from 'ssh2';
import type { ServerInput } from './types';

export type ConnectionTestResult = { ok: true } | { ok: false; message: string };

export class SshConnectionTester {
  async testConnection(input: Pick<ServerInput, 'host' | 'port' | 'username' | 'authMethod' | 'password' | 'keyPath' | 'connectionTimeout'>): Promise<ConnectionTestResult> {
    const client = new Client();

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: ConnectionTestResult) => {
        if (settled) {
          return;
        }
        settled = true;
        client.end();
        resolve(result);
      };

      client
        .on('ready', () => finish({ ok: true }))
        .on('error', (error: Error) => finish({ ok: false, message: normalizeSshError(error) }))
        .connect({
          host: input.host,
          port: input.port,
          username: input.username,
          password: input.authMethod === 'password' ? input.password : undefined,
          privateKey: input.authMethod === 'key' ? input.keyPath : undefined,
          readyTimeout: input.connectionTimeout * 1000,
        });
    });
  }
}

function normalizeSshError(error: Error) {
  if (error.message.toLowerCase().includes('authentication')) {
    return 'Authentication failed';
  }
  return error.message || 'SSH connection failed';
}
