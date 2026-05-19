import { describe, expect, it } from 'vitest';
import type { AutoPipelineApi, ServerInput, ServerRecord } from './types';

describe('preload contract', () => {
  it('exposes an invoke-based application API shape', async () => {
    const api = {
      app: {
        getVersion: async () => '0.1.0',
        ping: async () => 'pong',
      },
      servers: {
        list: async () => [],
        create: async (input) => serverFromInput(1, input),
        update: async (id, input) => serverFromInput(id, input),
        delete: async () => undefined,
        testConnection: async () => ({ ok: true }),
      },
      pipelines: {
        tree: async () => [],
        search: async () => [],
        createFolder: async (input) => ({
          ...(input as { name: string; parentId: number | null }),
          id: 1,
          createdAt: '2026-05-18T00:00:00Z',
          updatedAt: '2026-05-18T00:00:00Z',
        }),
        renameFolder: async (id, name) => ({
          id,
          name,
          parentId: null,
          createdAt: '2026-05-18T00:00:00Z',
          updatedAt: '2026-05-18T00:00:00Z',
        }),
        deleteFolder: async () => undefined,
        createPipeline: async (input) => ({
          ...(input as { name: string; folderId: number | null }),
          id: 1,
          dagEdges: [],
          parameters: [],
          shellSessions: [],
          createdAt: '2026-05-18T00:00:00Z',
          updatedAt: '2026-05-18T00:00:00Z',
        }),
        renamePipeline: async (id, name) => ({
          id,
          name,
          folderId: null,
          dagEdges: [],
          parameters: [],
          shellSessions: [],
          createdAt: '2026-05-18T00:00:00Z',
          updatedAt: '2026-05-18T00:00:00Z',
        }),
        getPipelineDeleteImpact: async () => ({ runCount: 0 }),
        deletePipeline: async () => undefined,
        getGraph: async () => ({ units: [], edges: [] }),
        saveGraph: async () => undefined,
        updateParameters: async (id, parameters) => ({
          id,
          name: 'Deploy API',
          folderId: null,
          dagEdges: [],
          parameters,
          shellSessions: [],
          createdAt: '2026-05-18T00:00:00Z',
          updatedAt: '2026-05-18T00:00:00Z',
        }),
        updateShellSessions: async (id, shellSessions) => ({
          id,
          name: 'Deploy API',
          folderId: null,
          dagEdges: [],
          parameters: [],
          shellSessions,
          createdAt: '2026-05-18T00:00:00Z',
          updatedAt: '2026-05-18T00:00:00Z',
        }),
      },
      commands: {
        list: async () => [],
        save: async () => undefined,
        delete: async () => undefined,
        reorder: async () => undefined,
      },
      runs: {
        start: async () => ({ id: 1, pipelineId: 1, status: 'succeeded' }),
        cancel: async () => undefined,
        resume: async () => ({ id: 2, pipelineId: 1, status: 'succeeded' }),
        list: async () => [],
        snapshot: async () => ({ id: 1, pipelineId: 1, status: 'succeeded', pipelineSnapshot: {}, contextSnapshot: {} }),
        onEvent: () => () => undefined,
      },
      settings: {
        get: async () => ({
          connectionPool: { idleTimeoutMinutes: 5, maxConnections: 10 },
          notifications: { inApp: true, toast: false },
          retention: { maxDays: 30, maxCount: 100 },
          language: 'zh-CN',
        }),
        update: async (settings) => settings,
        getRetention: async () => ({ maxDays: 30, maxCount: 100 }),
        updateRetention: async (settings) => settings,
      },
      notifications: {
        onRunCompleted: () => () => undefined,
      },
    } satisfies AutoPipelineApi;

    await expect(api.app.ping()).resolves.toBe('pong');
  });
});

function serverFromInput(id: number, input: ServerInput): ServerRecord {
  return {
    id,
    displayName: input.displayName,
    host: input.host,
    port: input.port,
    username: input.username,
    authMethod: input.authMethod,
    keyPath: input.keyPath ?? null,
    connectionTimeout: input.connectionTimeout,
    keepaliveInterval: input.keepaliveInterval,
    defaultDirectory: input.defaultDirectory ?? null,
    notes: input.notes ?? '',
    createdAt: '2026-05-18T00:00:00Z',
    updatedAt: '2026-05-18T00:00:00Z',
  };
}
