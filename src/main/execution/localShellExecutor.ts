import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { CommandRecord } from '../command/types.js';
import type { LocalCommandExecutor } from './types.js';

export class LocalShellExecutor implements LocalCommandExecutor {
  private readonly sessions = new Map<number, Map<string, LocalShellSession>>();

  async execute(command: CommandRecord, emit: Parameters<LocalCommandExecutor['execute']>[1]) {
    if (command.type !== 'shell') {
      throw new Error(`Unsupported local command type: ${command.type}`);
    }
    if (command.config.serverId !== null) {
      throw new Error('Remote command execution is not available until remote shell execution is implemented');
    }

    const { executable, args } = buildShellInvocation(command.config.shellType, command.config.script);

    return new Promise<{ exitCode: number }>((resolve) => {
      const child = spawn(executable, args, {
        windowsHide: true,
      });
      let settled = false;
      let timedOut = false;
      const timeout = command.config.timeout
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGINT');
            setTimeout(() => {
              if (!settled) {
                child.kill('SIGKILL');
              }
            }, 3000).unref();
          }, command.config.timeout * 1000)
        : undefined;

      child.stdout.on('data', (chunk: Buffer) => emit({ type: 'stdout', data: chunk.toString('utf8') }));
      child.stderr.on('data', (chunk: Buffer) => emit({ type: 'stderr', data: chunk.toString('utf8') }));
      child.on('error', (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        emit({ type: 'stderr', data: error.message });
        resolve({ exitCode: 1 });
      });
      child.on('close', (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve({ exitCode: timedOut ? 124 : (code ?? 1) });
      });
    });
  }

  async executeInSession(
    runId: number,
    sessionName: string,
    command: CommandRecord,
    emit: Parameters<LocalCommandExecutor['execute']>[1],
  ) {
    if (command.type !== 'shell') {
      throw new Error(`Unsupported local command type: ${command.type}`);
    }
    if (command.config.serverId !== null) {
      throw new Error('Remote command execution is not available until remote shell execution is implemented');
    }

    let runSessions = this.sessions.get(runId);
    if (!runSessions) {
      runSessions = new Map();
      this.sessions.set(runId, runSessions);
    }
    let session = runSessions.get(sessionName);
    if (!session || session.isClosed || session.shellType !== command.config.shellType) {
      session?.close();
      session = new LocalShellSession(command.config.shellType);
      runSessions.set(sessionName, session);
    }
    try {
      return await session.execute(command, emit);
    } catch (error) {
      if (!(error instanceof SessionClosedError)) {
        throw error;
      }
      session = new LocalShellSession(command.config.shellType);
      runSessions.set(sessionName, session);
      return session.execute(command, emit);
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

function buildShellInvocation(shellType: 'powershell' | 'cmd', script: string) {
  if (shellType === 'cmd') {
    return { executable: 'cmd.exe', args: ['/d', '/s', '/c', script] };
  }

  return { executable: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script] };
}

class LocalShellSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private queue = Promise.resolve();
  isClosed = false;

  constructor(readonly shellType: 'powershell' | 'cmd') {
    const { executable, args } = buildInteractiveShellInvocation(shellType);
    this.child = spawn(executable, args, { windowsHide: true });
    this.child.on('close', () => {
      this.isClosed = true;
    });
  }

  execute(command: CommandRecord, emit: Parameters<LocalCommandExecutor['execute']>[1]) {
    const run = this.queue.then(() => this.runCommand(command, emit));
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  close() {
    this.isClosed = true;
    if (!this.child.killed) {
      this.child.kill();
    }
  }

  private runCommand(command: CommandRecord, emit: Parameters<LocalCommandExecutor['execute']>[1]) {
    if (command.type !== 'shell') {
      throw new Error(`Unsupported local command type: ${command.type}`);
    }
    if (this.isClosed) {
      throw new SessionClosedError();
    }
    const marker = `__AUTOPIPELINE_EXIT_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
    let stdout = '';
    let stderr = '';
    let settled = false;

    return new Promise<{ exitCode: number }>((resolve) => {
      const timeout = command.config.timeout
        ? setTimeout(() => {
            finish(124);
            this.close();
          }, command.config.timeout * 1000)
        : undefined;

      const finish = (exitCode: number) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        this.child.stdout.off('data', onStdout);
        this.child.stderr.off('data', onStderr);
        this.child.off('error', onError);
        this.child.off('close', onClose);
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
      const onError = (error: Error) => {
        stderr += error.message;
        this.isClosed = true;
        finish(1);
      };
      const onClose = (code: number | null) => {
        this.isClosed = true;
        finish(code ?? 1);
      };

      this.child.stdout.on('data', onStdout);
      this.child.stderr.on('data', onStderr);
      this.child.on('error', onError);
      this.child.on('close', onClose);
      this.child.stdin.write(buildSessionCommand(command.config.shellType, command.config.script, marker));
    });
  }
}

function buildInteractiveShellInvocation(shellType: 'powershell' | 'cmd') {
  if (shellType === 'cmd') {
    return { executable: 'cmd.exe', args: ['/d', '/q'] };
  }

  return { executable: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoLogo', '-NoExit', '-Command', '-'] };
}

function buildSessionCommand(shellType: 'powershell' | 'cmd', script: string, marker: string) {
  if (shellType === 'cmd') {
    return `${script}\r\necho ${marker}%ERRORLEVEL%\r\n`;
  }

  return `$global:LASTEXITCODE = 0\r\n${script}\r\n$exitCode = if ($null -ne $global:LASTEXITCODE -and $global:LASTEXITCODE -ne 0) { $global:LASTEXITCODE } elseif ($?) { 0 } else { 1 }\r\nWrite-Output "${marker}$exitCode"\r\n`;
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
