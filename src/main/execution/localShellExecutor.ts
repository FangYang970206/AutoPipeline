import { spawn } from 'node:child_process';
import type { CommandRecord } from '../command/types.js';
import type { LocalCommandExecutor } from './types.js';

export class LocalShellExecutor implements LocalCommandExecutor {
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
}

function buildShellInvocation(shellType: 'powershell' | 'cmd', script: string) {
  if (shellType === 'cmd') {
    return { executable: 'cmd.exe', args: ['/d', '/s', '/c', script] };
  }

  return { executable: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script] };
}
