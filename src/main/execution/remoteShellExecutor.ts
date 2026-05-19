import type { ClientChannel } from 'ssh2';
import type { CommandRecord } from '../command/types.js';
import type { ServerRepository } from '../server/serverRepository.js';
import type { LocalCommandExecutor } from './types.js';
import type { SshConnectionPool } from './sshConnectionPool.js';

export class RemoteShellExecutor implements LocalCommandExecutor {
  private readonly sessions = new Map<number, Map<string, RemoteShellSession>>();

  constructor(
    private readonly servers: ServerRepository,
    private readonly pool: SshConnectionPool,
  ) {}

  async execute(command: CommandRecord, emit: Parameters<LocalCommandExecutor['execute']>[1], options?: Parameters<LocalCommandExecutor['execute']>[2]) {
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
      let forceClose: NodeJS.Timeout | undefined;
      const interrupt = () => {
        channel?.signal('INT');
        forceClose = setTimeout(() => {
          if (!settled) {
            channel?.close();
          }
        }, 3000);
        forceClose.unref();
      };
      const timeout = command.config.timeout
        ? setTimeout(() => {
            timedOut = true;
            interrupt();
          }, command.config.timeout * 1000)
        : undefined;
      options?.signal.addEventListener('abort', interrupt, { once: true });

      connection.client.exec(command.config.script, (error, stream) => {
        if (error) {
          settled = true;
          clearTimeout(timeout);
          clearTimeout(forceClose);
          options?.signal.removeEventListener('abort', interrupt);
          emit({ type: 'stderr', data: error.message });
          resolve({ exitCode: 1 });
          return;
        }
        channel = stream;
        if (options?.signal.aborted) {
          interrupt();
        }
        stream.on('data', (chunk: Buffer) => emit({ type: 'stdout', data: chunk.toString('utf8') }));
        stream.stderr.on('data', (chunk: Buffer) => emit({ type: 'stderr', data: chunk.toString('utf8') }));
        stream.on('close', (code: number | null) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          clearTimeout(forceClose);
          options?.signal.removeEventListener('abort', interrupt);
          resolve({ exitCode: timedOut ? 124 : (code ?? 0) });
        });
      });
    });
  }

  async executeInSession(
    runId: number,
    sessionName: string,
    command: CommandRecord,
    emit: Parameters<LocalCommandExecutor['execute']>[1],
    options?: Parameters<LocalCommandExecutor['execute']>[2],
  ) {
    if (command.type !== 'shell') {
      throw new Error(`Unsupported remote command type: ${command.type}`);
    }
    if (command.config.serverId === null) {
      throw new Error('Remote command execution requires a server');
    }

    let runSessions = this.sessions.get(runId);
    if (!runSessions) {
      runSessions = new Map();
      this.sessions.set(runId, runSessions);
    }
    const key = `${command.config.serverId}:${sessionName}`;
    let session = runSessions.get(key);
    if (!session || session.isClosed) {
      const server = this.servers.get(command.config.serverId);
      const connection = await this.pool.acquire(server);
      session = await RemoteShellSession.open(connection.client);
      runSessions.set(key, session);
    }
    try {
      return await session.execute(command, emit, options?.signal);
    } catch (error) {
      if (!(error instanceof SessionClosedError)) {
        throw error;
      }
      const server = this.servers.get(command.config.serverId);
      const connection = await this.pool.acquire(server);
      session = await RemoteShellSession.open(connection.client);
      runSessions.set(key, session);
      return session.execute(command, emit, options?.signal);
    }
  }

  async closeSessions(runId: number) {
    const runSessions = this.sessions.get(runId);
    if (!runSessions) {
      return;
    }
    for (const session of runSessions.values()) {
      session.close();
    }
    this.sessions.delete(runId);
  }
}

class RemoteShellSession {
  private queue = Promise.resolve();
  isClosed = false;

  private constructor(private readonly stream: ClientChannel) {}

  static open(client: { shell(callback: (error: Error | undefined, stream: ClientChannel) => void): void }) {
    return new Promise<RemoteShellSession>((resolve, reject) => {
      client.shell((error, stream) => {
        if (error) {
          reject(error);
          return;
        }
        const session = new RemoteShellSession(stream);
        stream.on('close', () => {
          session.isClosed = true;
        });
        resolve(session);
      });
    });
  }

  execute(command: CommandRecord, emit: Parameters<LocalCommandExecutor['execute']>[1], signal?: AbortSignal) {
    const run = this.queue.then(() => this.runCommand(command, emit, signal));
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  close() {
    this.isClosed = true;
    this.stream.close();
  }

  private runCommand(command: CommandRecord, emit: Parameters<LocalCommandExecutor['execute']>[1], signal?: AbortSignal) {
    if (command.type !== 'shell') {
      throw new Error(`Unsupported remote command type: ${command.type}`);
    }
    if (this.isClosed) {
      throw new SessionClosedError();
    }
    const marker = `__AUTOPIPELINE_EXIT_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
    let stdout = '';
    let stderr = '';
    let exitCodeFromChannel: number | null = null;
    let settled = false;

    return new Promise<{ exitCode: number }>((resolve) => {
      let forceClose: NodeJS.Timeout | undefined;
      const timeout = command.config.timeout
        ? setTimeout(() => {
            finish(124);
            this.close();
          }, command.config.timeout * 1000)
        : undefined;
      const interrupt = () => {
        this.stream.signal('INT');
        forceClose = setTimeout(() => {
          if (!settled) {
            this.close();
          }
        }, 3000);
        forceClose.unref();
      };
      signal?.addEventListener('abort', interrupt, { once: true });
      if (signal?.aborted) {
        interrupt();
      }

      const finish = (exitCode: number) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        clearTimeout(forceClose);
        signal?.removeEventListener('abort', interrupt);
        this.stream.off('data', onStdout);
        this.stream.stderr.off('data', onStderr);
        this.stream.off('exit', onExit);
        this.stream.off('close', onClose);
        if (stdout) {
          emit({ type: 'stdout', data: stdout });
        }
        resolve({ exitCode });
      };
      const onStdout = (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        const match = new RegExp(`${escapeRegExp(marker)}(-?\\d+)`).exec(stdout);
        if (match) {
          const markerIndex = stdout.indexOf(marker);
          const beforeMarker = stdout.slice(0, markerIndex).replace(/\r?\n?$/, '');
          stdout = beforeMarker ? `${beforeMarker}\n` : '';
          finish(Number(match[1]));
          return;
        }
        if (stdout.length > marker.length + 128) {
          const streamable = stdout.slice(0, stdout.length - marker.length - 128);
          stdout = stdout.slice(streamable.length);
          emit({ type: 'stdout', data: streamable });
        }
      };
      const onStderr = (chunk: Buffer) => {
        const data = chunk.toString('utf8');
        stderr += data;
        emit({ type: 'stderr', data });
      };
      const onExit = (code: number | null) => {
        exitCodeFromChannel = code;
      };
      const onClose = () => {
        this.isClosed = true;
        finish(exitCodeFromChannel ?? 1);
      };

      this.stream.on('data', onStdout);
      this.stream.stderr.on('data', onStderr);
      this.stream.on('exit', onExit);
      this.stream.on('close', onClose);
      // SSH shell sessions run in the server's login shell. shellType is not used here.
      this.stream.write(`${command.config.script}\nprintf '${marker}%s\\n' "$?"\n`);
    });
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class SessionClosedError extends Error {
  constructor() {
    super('Shell session is closed');
    this.name = 'SessionClosedError';
  }
}
