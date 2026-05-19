import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import i18n from './i18n';
import { useAppStore } from './store/appStore';
import type { ExecutionEvent } from './types';

vi.mock('@xyflow/react', async () => {
  const React = await import('react');
  return {
    addEdge: (connection: unknown, edges: unknown[]) => [...edges, connection],
    Background: () => null,
    Controls: () => null,
    ReactFlow: ({ children, nodes, onNodeClick }: { children: React.ReactNode; nodes: Array<{ id: string; data: { label: string } }>; onNodeClick?: (event: unknown, node: unknown) => void }) => (
      <div>
        {nodes.map((node) => (
          <button key={node.id} onClick={() => onNodeClick?.({}, node)} type="button">
            {node.data.label}
          </button>
        ))}
        {children}
      </div>
    ),
    useEdgesState: (initial: unknown[]) => {
      const [edges, setEdges] = React.useState(initial);
      return [edges, setEdges, vi.fn()];
    },
    useNodesState: (initial: unknown[]) => {
      const [nodes, setNodes] = React.useState(initial);
      return [nodes, setNodes, vi.fn()];
    },
  };
});

describe('App shell', () => {
  beforeEach(() => {
    useAppStore.setState({ activeView: 'pipelines' });
    void i18n.changeLanguage('zh-CN');
    window.autoPipeline = undefined;
  });

  it('renders the zh-CN activity shell by default and switches views', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: '流水线' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '服务器' }));

    expect(screen.getByRole('heading', { level: 1, name: '服务器' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '服务器列表' })).toBeInTheDocument();
  });

  it('supports switching to English labels', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'English' }));

    expect(screen.getByRole('button', { name: 'Servers' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Pipelines' })).toBeInTheDocument();
  });

  it('creates a server from the Server view through the preload API', async () => {
    const createServer = vi.fn().mockResolvedValue({
      id: 2,
      displayName: 'Production',
      host: 'prod.example.com',
      port: 22,
      username: 'deploy',
      authMethod: 'password',
      keyPath: null,
      connectionTimeout: 30,
      keepaliveInterval: 15,
      defaultDirectory: null,
      notes: '',
      createdAt: '2026-05-18T00:00:00Z',
      updatedAt: '2026-05-18T00:00:00Z',
    });
    window.autoPipeline = {
      app: {
        getVersion: async () => '0.1.0',
        ping: async () => 'pong',
      },
      servers: {
        list: vi.fn().mockResolvedValue([]),
        create: createServer,
        update: vi.fn(),
        delete: vi.fn(),
        testConnection: vi.fn().mockResolvedValue({ ok: true }),
      },
      pipelines: createPipelineApiMock(),
      commands: createCommandApiMock(),
      runs: createRunsApiMock(),
      settings: createSettingsApiMock(),
    };

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '服务器' }));

    fireEvent.change(await screen.findByLabelText('显示名称'), { target: { value: 'Production' } });
    fireEvent.change(screen.getByLabelText('主机'), { target: { value: 'prod.example.com' } });
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'deploy' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'super-secret' } });
    fireEvent.click(screen.getByRole('button', { name: '保存服务器' }));

    await waitFor(() =>
      expect(createServer).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: 'Production',
          host: 'prod.example.com',
          username: 'deploy',
          password: 'super-secret',
        }),
      ),
    );
    expect(await screen.findByText('Production')).toBeInTheDocument();
  });

  it('creates and filters pipelines in the Pipeline view', async () => {
    const createFolder = vi.fn().mockResolvedValue({
      id: 1,
      name: 'Production',
      parentId: null,
      createdAt: '2026-05-18T00:00:00Z',
      updatedAt: '2026-05-18T00:00:00Z',
    });
    const createPipeline = vi.fn().mockResolvedValue({
      id: 2,
      name: 'Deploy API',
      folderId: 1,
      dagEdges: [],
      parameters: [],
      shellSessions: [],
      createdAt: '2026-05-18T00:00:00Z',
      updatedAt: '2026-05-18T00:00:00Z',
    });
    window.autoPipeline = {
      app: {
        getVersion: async () => '0.1.0',
        ping: async () => 'pong',
      },
      servers: createServerApiMock(),
      pipelines: {
        ...createPipelineApiMock(),
        tree: vi.fn().mockResolvedValue([]),
        createFolder,
        createPipeline,
        search: vi.fn().mockResolvedValue([
          {
            id: 1,
            name: 'Production',
            parentId: null,
            createdAt: '2026-05-18T00:00:00Z',
            updatedAt: '2026-05-18T00:00:00Z',
            folders: [],
            pipelines: [
              {
                id: 2,
                name: 'Deploy API',
                folderId: 1,
                dagEdges: [],
                parameters: [],
                shellSessions: [],
                createdAt: '2026-05-18T00:00:00Z',
                updatedAt: '2026-05-18T00:00:00Z',
              },
            ],
          },
        ]),
      },
      commands: createCommandApiMock(),
      runs: createRunsApiMock(),
      settings: createSettingsApiMock(),
    };

    render(<App />);

    fireEvent.change(await screen.findByLabelText('文件夹名称'), { target: { value: 'Production' } });
    fireEvent.click(screen.getByRole('button', { name: '创建文件夹' }));
    await waitFor(() => expect(createFolder).toHaveBeenCalledWith({ name: 'Production', parentId: null }));

    fireEvent.change(screen.getByLabelText('Pipeline 名称'), { target: { value: 'Deploy API' } });
    fireEvent.click(screen.getByRole('button', { name: '创建 Pipeline' }));
    await waitFor(() => expect(createPipeline).toHaveBeenCalledWith({ name: 'Deploy API', folderId: 1 }));

    fireEvent.change(screen.getByLabelText('搜索 Pipeline'), { target: { value: 'deploy' } });
    expect(await screen.findByText('Deploy API')).toBeInTheDocument();
  });

  it('starts a pipeline run and renders streamed command output', async () => {
    const listeners: Array<(event: ExecutionEvent) => void> = [];
    window.autoPipeline = {
      app: {
        getVersion: async () => '0.1.0',
        ping: async () => 'pong',
      },
      servers: createServerApiMock(),
      pipelines: {
        ...createPipelineApiMock(),
        tree: vi.fn().mockResolvedValue([
          {
            id: 1,
            name: 'Production',
            parentId: null,
            createdAt: '2026-05-18T00:00:00Z',
            updatedAt: '2026-05-18T00:00:00Z',
            folders: [],
            pipelines: [
              {
                id: 2,
                name: 'Deploy API',
                folderId: 1,
                dagEdges: [],
                parameters: [],
                shellSessions: [],
                createdAt: '2026-05-18T00:00:00Z',
                updatedAt: '2026-05-18T00:00:00Z',
              },
            ],
          },
        ]),
        getGraph: vi.fn().mockResolvedValue({
          units: [{ id: 'unit-a', name: 'Build', position: { x: 0, y: 0 } }],
          edges: [],
        }),
      },
      commands: createCommandApiMock(),
      runs: {
        start: vi.fn().mockImplementation(async () => {
          for (const listener of listeners) {
            listener({ type: 'run-status', runId: 7, status: 'running' });
            listener({ type: 'command-status', runId: 7, commandId: 'cmd-build', status: 'running' });
            listener({ type: 'stdout', runId: 7, commandId: 'cmd-build', data: 'building\n' });
            listener({ type: 'command-status', runId: 7, commandId: 'cmd-build', status: 'succeeded' });
            listener({ type: 'run-status', runId: 7, status: 'succeeded' });
          }
          return { id: 7, pipelineId: 2, status: 'succeeded' };
        }),
        cancel: vi.fn().mockResolvedValue(undefined),
        resume: vi.fn().mockResolvedValue({ id: 8, pipelineId: 2, status: 'succeeded' }),
        list: vi.fn().mockResolvedValue([]),
        snapshot: vi.fn().mockResolvedValue({ id: 7, pipelineId: 2, status: 'succeeded', pipelineSnapshot: {}, contextSnapshot: {} }),
        onEvent: vi.fn().mockImplementation((callback) => {
          listeners.push(callback);
          return () => undefined;
        }),
      },
      settings: createSettingsApiMock(),
    };

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Deploy API' }));
    fireEvent.click(await screen.findByRole('button', { name: '运行 Pipeline' }));

    expect(await screen.findByText('building')).toBeInTheDocument();
    expect(screen.getByText('Pipeline 运行成功')).toBeInTheDocument();
  });

  it('shows cancel, resume, and re-run controls for run states', async () => {
    const listeners: Array<(event: ExecutionEvent) => void> = [];
    let finishStart!: () => void;
    const startCanFinish = new Promise<void>((resolve) => {
      finishStart = resolve;
    });
    const start = vi.fn().mockImplementation(async () => {
      for (const listener of listeners) {
        listener({ type: 'run-status', runId: 7, status: 'running' });
      }
      await startCanFinish;
      return { id: 7, pipelineId: 2, status: 'failed', parameters: { env: 'prod', confirmDeploy: true } };
    });
    const cancel = vi.fn().mockResolvedValue(undefined);
    const resume = vi.fn().mockResolvedValue({ id: 8, pipelineId: 2, status: 'succeeded', parameters: { env: 'prod', confirmDeploy: true } });
    window.autoPipeline = {
      app: {
        getVersion: async () => '0.1.0',
        ping: async () => 'pong',
      },
      servers: createServerApiMock(),
      pipelines: {
        ...createPipelineApiMock(),
        tree: vi.fn().mockResolvedValue([
          {
            id: 1,
            name: 'Production',
            parentId: null,
            createdAt: '2026-05-18T00:00:00Z',
            updatedAt: '2026-05-18T00:00:00Z',
            folders: [],
            pipelines: [
              {
                id: 2,
                name: 'Deploy API',
                folderId: 1,
                dagEdges: [],
                parameters: [
                  { name: 'env', type: 'string', defaultValue: 'dev' },
                  { name: 'confirmDeploy', type: 'boolean', defaultValue: false },
                ],
                shellSessions: [],
                createdAt: '2026-05-18T00:00:00Z',
                updatedAt: '2026-05-18T00:00:00Z',
              },
            ],
          },
        ]),
        getGraph: vi.fn().mockResolvedValue({
          units: [{ id: 'unit-a', name: 'Build', position: { x: 0, y: 0 } }],
          edges: [],
        }),
      },
      commands: createCommandApiMock(),
      runs: {
        start,
        cancel,
        resume,
        list: vi.fn().mockResolvedValue([]),
        snapshot: vi.fn().mockResolvedValue({ id: 7, pipelineId: 2, status: 'failed', pipelineSnapshot: {}, contextSnapshot: {} }),
        onEvent: vi.fn().mockImplementation((callback) => {
          listeners.push(callback);
          return () => undefined;
        }),
      },
      settings: createSettingsApiMock(),
    };
    vi.spyOn(window, 'prompt').mockReturnValue('prod');
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Deploy API' }));
    await screen.findByRole('button', { name: 'Deploy API' });
    fireEvent.click(screen.getAllByRole('button').find((button) => button.textContent === '运行 Pipeline')!);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(7));
    finishStart();
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-run' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(resume).toHaveBeenCalledWith(7));
    fireEvent.click(await screen.findByRole('button', { name: 'Re-run' }));
    await waitFor(() => expect(window.prompt).toHaveBeenLastCalledWith('env', 'prod'));
    expect(window.confirm).toHaveBeenLastCalledWith('confirmDeploy? Previous: true');
  });
});

function createServerApiMock() {
  return {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
  };
}

function createCommandApiMock() {
  return {
    list: vi.fn().mockResolvedValue([]),
    save: vi.fn(),
    delete: vi.fn(),
    reorder: vi.fn(),
  };
}

function createPipelineApiMock() {
  return {
    tree: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([]),
    createFolder: vi.fn(),
    renameFolder: vi.fn(),
    deleteFolder: vi.fn(),
    createPipeline: vi.fn(),
    renamePipeline: vi.fn(),
    getPipelineDeleteImpact: vi.fn().mockResolvedValue({ runCount: 0 }),
    deletePipeline: vi.fn(),
    getGraph: vi.fn().mockResolvedValue({ units: [], edges: [] }),
    saveGraph: vi.fn(),
    updateParameters: vi.fn().mockImplementation(async (id, parameters) => ({
      id,
      name: 'Deploy API',
      folderId: null,
      dagEdges: [],
      parameters,
      shellSessions: [],
      createdAt: '2026-05-18T00:00:00Z',
      updatedAt: '2026-05-18T00:00:00Z',
    })),
    updateShellSessions: vi.fn().mockImplementation(async (id, shellSessions) => ({
      id,
      name: 'Deploy API',
      folderId: null,
      dagEdges: [],
      parameters: [],
      shellSessions,
      createdAt: '2026-05-18T00:00:00Z',
      updatedAt: '2026-05-18T00:00:00Z',
    })),
  };
}

function createRunsApiMock() {
  return {
    start: vi.fn().mockResolvedValue({ id: 1, pipelineId: 1, status: 'succeeded' }),
    cancel: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue({ id: 2, pipelineId: 1, status: 'succeeded' }),
    list: vi.fn().mockResolvedValue([]),
    snapshot: vi.fn().mockResolvedValue({ id: 1, pipelineId: 1, status: 'succeeded', pipelineSnapshot: {}, contextSnapshot: {} }),
    onEvent: vi.fn().mockReturnValue(() => undefined),
  };
}

function createSettingsApiMock() {
  return {
    getRetention: vi.fn().mockResolvedValue({ maxDays: 30, maxCount: 100 }),
    updateRetention: vi.fn().mockResolvedValue({ maxDays: 30, maxCount: 100 }),
  };
}
