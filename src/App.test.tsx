import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App, SettingsPanel } from './App';
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
      notifications: createNotificationApiMock(),
      fileBrowser: createFileBrowserApiMock(),
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
      notifications: createNotificationApiMock(),
      fileBrowser: createFileBrowserApiMock(),
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

  it('exports and imports pipelines through the Pipeline view', async () => {
    const exportToFile = vi.fn().mockResolvedValue({ filePath: 'D:/tmp/deploy.json' });
    const inspectImportFile = vi.fn().mockResolvedValue({
      filePath: 'D:/tmp/deploy.json',
      duplicateName: 'Deploy API',
      unknownServers: ['Prod'],
      localServers: ['Production'],
    });
    const importFromFile = vi.fn().mockResolvedValue({
      id: 3,
      name: 'Deploy API Copy',
      folderId: null,
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
        exportToFile,
        inspectImportFile,
        importFromFile,
      },
      commands: createCommandApiMock(),
      runs: createRunsApiMock(),
      settings: createSettingsApiMock(),
      notifications: createNotificationApiMock(),
      fileBrowser: createFileBrowserApiMock(),
    };
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Export' }));
    await waitFor(() => expect(exportToFile).toHaveBeenCalledWith(2));
    fireEvent.click(screen.getByRole('button', { name: 'Import Pipeline' }));
    fireEvent.change(await screen.findByLabelText('Prod'), { target: { value: 'Production' } });
    fireEvent.click(screen.getByLabelText('Rename duplicate'));
    fireEvent.change(screen.getByDisplayValue('Deploy API Copy'), { target: { value: 'Deploy API Copy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Import' }));

    await waitFor(() =>
      expect(importFromFile).toHaveBeenCalledWith('D:/tmp/deploy.json', {
        serverMappings: { Prod: 'Production' },
        duplicateName: { mode: 'rename', name: 'Deploy API Copy' },
      }),
    );
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
      notifications: createNotificationApiMock(),
      fileBrowser: createFileBrowserApiMock(),
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
      notifications: createNotificationApiMock(),
      fileBrowser: createFileBrowserApiMock(),
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

  it('renders run completion notifications with a status icon', async () => {
    const completedListeners: Array<(notification: { runId: number; pipelineId: number; pipelineName: string; status: 'succeeded' }) => void> = [];
    window.autoPipeline = {
      app: {
        getVersion: async () => '0.1.0',
        ping: async () => 'pong',
      },
      servers: createServerApiMock(),
      pipelines: createPipelineApiMock(),
      commands: createCommandApiMock(),
      runs: createRunsApiMock(),
      settings: createSettingsApiMock(),
      notifications: {
        onRunCompleted: vi.fn().mockImplementation((callback) => {
          completedListeners.push(callback);
          return () => undefined;
        }),
      },
      fileBrowser: createFileBrowserApiMock(),
    };

    render(<App />);
    act(() => {
      completedListeners[0]({ runId: 9, pipelineId: 2, pipelineName: 'Deploy API', status: 'succeeded' });
    });
    expect(await screen.findByText('Deploy API succeeded')).toBeInTheDocument();
    expect(screen.getByLabelText('Last run succeeded')).toBeInTheDocument();
  });

  it('browses local and remote files and transfers selected files', async () => {
    useAppStore.setState({ activeView: 'fileBrowser' });
    const listLocal = vi.fn().mockResolvedValue([
      { name: 'dist', path: 'C:\\workspace\\dist', type: 'directory', size: 0, modifiedAt: '2026-05-18T00:00:00Z' },
      { name: 'bundle.zip', path: 'C:\\workspace\\bundle.zip', type: 'file', size: 4096, modifiedAt: '2026-05-18T00:00:00Z' },
    ]);
    const listRemote = vi.fn().mockResolvedValue([
      { name: 'releases', path: '/var/www/releases', type: 'directory', size: 0, modifiedAt: '2026-05-18T00:00:00Z' },
      { name: 'app.log', path: '/var/www/app.log', type: 'file', size: 2048, modifiedAt: '2026-05-18T00:00:00Z' },
    ]);
    const upload = vi.fn().mockResolvedValue(undefined);
    const download = vi.fn().mockResolvedValue(undefined);
    window.autoPipeline = {
      app: {
        getVersion: async () => '0.1.0',
        ping: async () => 'pong',
      },
      servers: {
        ...createServerApiMock(),
        list: vi.fn().mockResolvedValue([
          {
            id: 1,
            displayName: 'Production',
            host: 'prod.example.com',
            port: 22,
            username: 'deploy',
            authMethod: 'password',
            keyPath: null,
            connectionTimeout: 30,
            keepaliveInterval: 15,
            defaultDirectory: '/var/www',
            notes: '',
            createdAt: '2026-05-18T00:00:00Z',
            updatedAt: '2026-05-18T00:00:00Z',
          },
        ]),
      },
      pipelines: createPipelineApiMock(),
      commands: createCommandApiMock(),
      runs: createRunsApiMock(),
      settings: createSettingsApiMock(),
      notifications: createNotificationApiMock(),
      fileBrowser: {
        ...createFileBrowserApiMock(),
        listLocal,
        listRemote,
        upload,
        download,
      },
    };

    render(<App />);

    expect(await screen.findByRole('heading', { level: 1, name: '文件浏览器' })).toBeInTheDocument();
    expect(await screen.findByText('bundle.zip')).toBeInTheDocument();
    expect(await screen.findByText('app.log')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByText('[dir] dist'), { key: 'Enter' });
    await waitFor(() => expect(listLocal).toHaveBeenCalledWith('C:\\workspace\\dist'));
    fireEvent.click(screen.getByText('bundle.zip'));
    fireEvent.click(screen.getByText('app.log'));
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(upload).toHaveBeenCalledWith(1, 'C:\\workspace\\bundle.zip', '/var/www'));
    fireEvent.click(await screen.findByText('app.log'));
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(download).toHaveBeenCalledWith(1, '/var/www/app.log', 'C:\\workspace\\dist'));
  });

  it('saves all settings sections', async () => {
    const update = vi.fn().mockImplementation(async (settings) => settings);
    window.autoPipeline = {
      app: {
        getVersion: async () => '0.1.0',
        ping: async () => 'pong',
      },
      servers: createServerApiMock(),
      pipelines: createPipelineApiMock(),
      commands: createCommandApiMock(),
      runs: createRunsApiMock(),
      settings: {
        ...createSettingsApiMock(),
        update,
      },
      notifications: createNotificationApiMock(),
      fileBrowser: createFileBrowserApiMock(),
    };

    const { container } = render(<SettingsPanel />);
    fireEvent.change(container.querySelector('#settings-idle-timeout')!, { target: { value: '7' } });
    expect(screen.getByText('7 min')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Windows toast'));
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'en' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionPool: expect.objectContaining({ idleTimeoutMinutes: 7 }),
          notifications: expect.objectContaining({ toast: true }),
          language: 'en',
        }),
      ),
    );
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
    exportToFile: vi.fn().mockResolvedValue({ filePath: 'pipeline.json' }),
    inspectImportFile: vi.fn().mockResolvedValue({ filePath: null }),
    importFromFile: vi.fn(),
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
    get: vi.fn().mockResolvedValue({
      connectionPool: { idleTimeoutMinutes: 5, maxConnections: 10 },
      notifications: { inApp: true, toast: false },
      retention: { maxDays: 30, maxCount: 100 },
      language: 'zh-CN',
    }),
    update: vi.fn().mockImplementation(async (settings) => settings),
    getRetention: vi.fn().mockResolvedValue({ maxDays: 30, maxCount: 100 }),
    updateRetention: vi.fn().mockResolvedValue({ maxDays: 30, maxCount: 100 }),
  };
}

function createNotificationApiMock() {
  return {
    onRunCompleted: vi.fn().mockReturnValue(() => undefined),
  };
}

function createFileBrowserApiMock() {
  return {
    listLocal: vi.fn().mockResolvedValue([]),
    createLocalDirectory: vi.fn().mockResolvedValue(undefined),
    deleteLocal: vi.fn().mockResolvedValue(undefined),
    renameLocal: vi.fn().mockResolvedValue(undefined),
    listRemote: vi.fn().mockResolvedValue([]),
    createRemoteDirectory: vi.fn().mockResolvedValue(undefined),
    deleteRemote: vi.fn().mockResolvedValue(undefined),
    renameRemote: vi.fn().mockResolvedValue(undefined),
    upload: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue(undefined),
    onTransferProgress: vi.fn().mockReturnValue(() => undefined),
  };
}
