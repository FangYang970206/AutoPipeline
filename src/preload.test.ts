import { describe, expect, it } from 'vitest';
import type { AutoPipelineApi } from './types';

describe('preload contract', () => {
  it('exposes an invoke-based application API shape', async () => {
    const api = {
      app: {
        getVersion: async () => '0.1.0',
        ping: async () => 'pong',
      },
    } satisfies AutoPipelineApi;

    await expect(api.app.ping()).resolves.toBe('pong');
  });
});
