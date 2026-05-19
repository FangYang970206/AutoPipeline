import { generateKeyPairSync } from 'node:crypto';
import { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import { Server as SshServer } from 'ssh2';
import type { ServerChannel } from 'ssh2';
import { afterEach, describe, expect, it } from 'vitest';
import { CommandRepository } from '../command/commandRepository';
import { InMemoryCredentialStore } from '../server/credentialStore';
import { ServerRepository } from '../server/serverRepository';
import { migratePipelineSchema } from '../pipeline/schema';
import { migrateServerSchema } from '../server/schema';
import { RemoteShellExecutor } from './remoteShellExecutor';
import { SshConnectionPool } from './sshConnectionPool';

const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
  format: 'pem',
  type: 'pkcs1',
});

let server: SshServer | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

describe('RemoteShellExecutor', () => {
  it('executes a shell command over SSH and streams stdout and stderr', async () => {
    let receivedScript = '';
    const port = await startMockSshServer((script, stream) => {
      receivedScript = script;
      stream.write('remote stdout\n');
      stream.stderr.write('remote stderr\n');
      stream.exit(0);
      stream.end();
    });
    const { commands, executor, serverId } = await setup(port);
    commands.saveCommands('unit-a', [
      {
        id: 'cmd-remote',
        type: 'shell',
        order: 0,
        config: {
          name: 'Remote Build',
          script: 'echo remote',
          serverId,
          shellType: 'powershell',
          onFailure: 'stop',
        },
      },
    ]);
    const events: Array<{ type: 'stdout' | 'stderr'; data: string }> = [];

    const result = await executor.execute(commands.listCommands('unit-a')[0], (event) => {
      if (event.type === 'stdout' || event.type === 'stderr') {
        events.push(event);
      }
    });

    expect(result.exitCode).toBe(0);
    expect(receivedScript).toBe('echo remote');
    expect(events).toEqual([
      { type: 'stdout', data: 'remote stdout\n' },
      { type: 'stderr', data: 'remote stderr\n' },
    ]);
  });

  it('reuses a named SSH shell session and preserves shell state', async () => {
    const port = await startMockSshShellServer();
    const { commands, executor, serverId } = await setup(port);
    commands.saveCommands('unit-a', [
      {
        id: 'cmd-cd',
        type: 'shell',
        order: 0,
        config: {
          name: 'Enter app',
          script: 'cd app',
          serverId,
          shellType: 'cmd',
          onFailure: 'stop',
          sessionName: 'deploy',
          reuseSession: true,
        },
      },
      {
        id: 'cmd-pwd',
        type: 'shell',
        order: 1,
        config: {
          name: 'Print cwd',
          script: 'pwd',
          serverId,
          shellType: 'cmd',
          onFailure: 'stop',
          sessionName: 'deploy',
          reuseSession: true,
        },
      },
    ]);
    const chunks: string[] = [];

    await executor.executeInSession!(1, 'deploy', commands.listCommands('unit-a')[0], () => {});
    const result = await executor.executeInSession!(1, 'deploy', commands.listCommands('unit-a')[1], (event) => {
      if (event.type === 'stdout') {
        chunks.push(event.data);
      }
    });
    await executor.closeSessions!(1);

    expect(result.exitCode).toBe(0);
    expect(chunks.join('')).toContain('/home/deploy/app');
  });
});

async function setup(port: number) {
  const db = new Database(':memory:');
  migrateServerSchema(db);
  migratePipelineSchema(db);
  const credentials = new InMemoryCredentialStore();
  const servers = new ServerRepository(db, credentials, { findPipelineNamesUsingServer: () => [] });
  const serverRecord = await servers.create({
    displayName: 'Prod',
    host: '127.0.0.1',
    port,
    username: 'deploy',
    authMethod: 'password',
    password: 'secret',
    connectionTimeout: 5,
    keepaliveInterval: 15,
  });
  const pool = new SshConnectionPool(credentials, { idleTimeoutMs: 1000 });
  const commands = new CommandRepository(db);
  db.exec(`
    insert into pipelines (id, name, folder_id, dag_edges, shell_sessions) values (1, 'Deploy API', null, '[]', '["deploy"]');
    insert into execution_units (id, pipeline_id, name, position) values ('unit-a', 1, 'Build', '{}');
  `);

  return { commands, executor: new RemoteShellExecutor(servers, pool), serverId: serverRecord.id };
}

async function startMockSshServer(onExec: (script: string, stream: ServerChannel) => void) {
  server = new SshServer({ hostKeys: [hostKey] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === 'deploy' && ctx.password === 'secret') {
        ctx.accept();
        return;
      }
      ctx.reject();
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('exec', (acceptExec, _reject, info) => {
          onExec(info.command, acceptExec());
        });
      });
    });
  });

  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

async function startMockSshShellServer() {
  server = new SshServer({ hostKeys: [hostKey] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === 'deploy' && ctx.password === 'secret') {
        ctx.accept();
        return;
      }
      ctx.reject();
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('pty', (acceptPty) => {
          acceptPty?.();
        });
        session.on('shell', (acceptShell) => {
          const stream = acceptShell();
          let cwd = '/home/deploy';
          let buffer = '';
          stream.on('data', (chunk: Buffer) => {
            buffer += chunk.toString('utf8');
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              if (line === 'cd app') {
                cwd = '/home/deploy/app';
              } else if (line === 'pwd') {
                stream.write(`${cwd}\n`);
              } else {
                const match = /printf '([^']+)%s\\n' "\$\?"/.exec(line);
                if (match) {
                  stream.write(`${match[1]}0\n`);
                }
              }
            }
          });
        });
      });
    });
  });

  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}
