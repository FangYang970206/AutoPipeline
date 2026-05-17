import type { ClientChannel } from 'ssh2';
import type { CommandRecord } from '../command/types.js';
import type { ServerRepository } from '../server/serverRepository.js';
import type { LocalCommandExecutor } from './types.js';
import type { SshConnectionPool } from './sshConnectionPool.js';

export class RemoteShellExecutor implements LocalCommandExecutor {
  constructor(
    private readonly servers: ServerRepository,
    private readonly pool: SshConnectionPool,
  ) {}

  async execute(command: CommandRecord, emit: Parameters<LocalCommandExecutor['execute']>[1]) {
    if (command.type !== 'shell') {
      throw new Error(`Unsupported remote command type: ${command.type}`);
    }
    if (command.config.serverId === null) {
      throw new Error('Remote command execution requires a server');
    }

    const server = this.servers.get(command.config.serverId);
    const connection = await this.pool.acquire(server);

    return new Promise<{ exitCode: number }>((resolve) => {
      let settled = false;
      let timedOut = false;
      let channel: ClientChannel | undefined;
      const timeout = command.config.timeout
        ? setTimeout(() => {
            timedOut = true;
            channel?.signal('INT');
            setTimeout(() => {
              if (!settled) {
                channel?.close();
              }
            }, 3000).unref();
          }, command.config.timeout * 1000)
        : undefined;

      connection.client.exec(command.config.script, (error, stream) => {
        if (error) {
          settled = true;
          clearTimeout(timeout);
          emit({ type: 'stderr', data: error.message });
          resolve({ exitCode: 1 });
          return;
        }
        channel = stream;
        stream.on('data', (chunk: Buffer) => emit({ type: 'stdout', data: chunk.toString('utf8') }));
        stream.stderr.on('data', (chunk: Buffer) => emit({ type: 'stderr', data: chunk.toString('utf8') }));
        stream.on('close', (code: number | null) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          resolve({ exitCode: timedOut ? 124 : (code ?? 0) });
        });
      });
    });
  }
}
