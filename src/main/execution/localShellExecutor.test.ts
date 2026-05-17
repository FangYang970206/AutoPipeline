import { describe, expect, it } from 'vitest';
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
