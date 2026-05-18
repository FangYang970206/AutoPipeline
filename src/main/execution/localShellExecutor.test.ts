import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandRecord } from '../command/types';
import { LocalShellExecutor } from './localShellExecutor';

describe('LocalShellExecutor', () => {
  it('runs a local cmd shell command and streams stdout', async () => {
    const executor = new LocalShellExecutor();
    const chunks: string[] = [];

    const result = await executor.execute(createShellCommand('echo hello', 'cmd'), (event) => {
      if (event.type === 'stdout') {
        chunks.push(event.data);
      }
    });

    expect(result.exitCode).toBe(0);
    expect(chunks.join('')).toContain('hello');
  });

  it('fails a timed out command', async () => {
    const executor = new LocalShellExecutor();

    const result = await executor.execute(createShellCommand('ping 127.0.0.1 -n 6 > nul', 'cmd', 1), () => {});

    expect(result.exitCode).not.toBe(0);
  }, 10000);

  it('reuses a named cmd shell session and preserves working directory state', async () => {
    const executor = new LocalShellExecutor();
    const sessionDir = mkdtempSync(join(tmpdir(), 'autopipeline-session-'));
    const chunks: string[] = [];

    await executor.executeInSession!(1, 'deploy', createShellCommand(`cd /d "${sessionDir}"`, 'cmd'), () => {});
    const result = await executor.executeInSession!(1, 'deploy', createShellCommand('cd', 'cmd'), (event) => {
      if (event.type === 'stdout') {
        chunks.push(event.data);
      }
    });
    await executor.closeSessions!(1);

    expect(result.exitCode).toBe(0);
    expect(chunks.join('').toLocaleLowerCase()).toContain(sessionDir.toLocaleLowerCase());
  });

  it('recreates a named cmd shell session after a timeout closes it', async () => {
    const executor = new LocalShellExecutor();
    const chunks: string[] = [];

    const timedOut = await executor.executeInSession!(1, 'deploy', createShellCommand('ping 127.0.0.1 -n 6 > nul', 'cmd', 1), () => {});
    const result = await executor.executeInSession!(1, 'deploy', createShellCommand('echo recovered', 'cmd'), (event) => {
      if (event.type === 'stdout') {
        chunks.push(event.data);
      }
    });
    await executor.closeSessions!(1);

    expect(timedOut.exitCode).toBe(124);
    expect(result.exitCode).toBe(0);
    expect(chunks.join('')).toContain('recovered');
  }, 10000);

  it('recreates a named cmd shell session for queued work after a concurrent timeout closes it', async () => {
    const executor = new LocalShellExecutor();
    const chunks: string[] = [];

    const timedOut = executor.executeInSession!(1, 'deploy', createShellCommand('ping 127.0.0.1 -n 6 > nul', 'cmd', 1), () => {});
    const recovered = executor.executeInSession!(1, 'deploy', createShellCommand('echo queued recovered', 'cmd'), (event) => {
      if (event.type === 'stdout') {
        chunks.push(event.data);
      }
    });
    await expect(timedOut).resolves.toMatchObject({ exitCode: 124 });
    await expect(recovered).resolves.toMatchObject({ exitCode: 0 });
    await executor.closeSessions!(1);

    expect(chunks.join('')).toContain('queued recovered');
  }, 10000);

  it('captures the exit code when a session command exits the shell', async () => {
    const executor = new LocalShellExecutor();

    const result = await executor.executeInSession!(1, 'deploy', createShellCommand('exit 7', 'cmd'), () => {});

    expect(result.exitCode).toBe(7);
  });

  it('does not reuse a stale PowerShell LASTEXITCODE for the next session command', async () => {
    const executor = new LocalShellExecutor();
    const chunks: string[] = [];

    const failed = await executor.executeInSession!(1, 'deploy', createShellCommand('cmd /c exit 7', 'powershell'), () => {});
    const recovered = await executor.executeInSession!(1, 'deploy', createShellCommand('Write-Output ok', 'powershell'), (event) => {
      if (event.type === 'stdout') {
        chunks.push(event.data);
      }
    });
    await executor.closeSessions!(1);

    expect(failed.exitCode).toBe(7);
    expect(recovered.exitCode).toBe(0);
    expect(chunks.join('')).toContain('ok');
  });
});

function createShellCommand(script: string, shellType: 'cmd' | 'powershell', timeout?: number): CommandRecord {
  return {
    id: `cmd-${shellType}`,
    unitId: 'unit-a',
    order: 0,
    type: 'shell',
    config: {
      name: 'Local command',
      script,
      serverId: null,
      shellType,
      timeout,
      onFailure: 'stop',
    },
  };
}
