import { contextBridge, ipcRenderer } from 'electron';

interface AutoPipelineApi {
  app: {
    getVersion: () => Promise<string>;
    ping: () => Promise<'pong'>;
  };
  servers: {
    list: () => Promise<unknown>;
    create: (input: unknown) => Promise<unknown>;
    update: (id: number, input: unknown) => Promise<unknown>;
    delete: (id: number) => Promise<void>;
    testConnection: (input: unknown) => Promise<unknown>;
  };
  pipelines: {
    tree: () => Promise<unknown>;
    search: (query: string) => Promise<unknown>;
    createFolder: (input: unknown) => Promise<unknown>;
    renameFolder: (id: number, name: string) => Promise<unknown>;
    deleteFolder: (id: number) => Promise<void>;
    createPipeline: (input: unknown) => Promise<unknown>;
    renamePipeline: (id: number, name: string) => Promise<unknown>;
    getPipelineDeleteImpact: (id: number) => Promise<unknown>;
    deletePipeline: (id: number) => Promise<void>;
    getGraph: (pipelineId: number) => Promise<unknown>;
    saveGraph: (pipelineId: number, graph: unknown) => Promise<void>;
    updateParameters: (pipelineId: number, parameters: unknown) => Promise<unknown>;
  };
  commands: {
    list: (unitId: string) => Promise<unknown>;
    save: (unitId: string, commands: unknown) => Promise<void>;
    delete: (id: string) => Promise<void>;
    reorder: (unitId: string, orderedIds: string[]) => Promise<void>;
  };
  runs: {
    start: (pipelineId: number, parameters?: unknown) => Promise<unknown>;
    onEvent: (callback: (event: unknown) => void) => () => void;
  };
}

const api: AutoPipelineApi = {
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version') as Promise<string>,
    ping: () => ipcRenderer.invoke('app:ping') as Promise<'pong'>,
  },
  servers: {
    list: () => ipcRenderer.invoke('servers:list'),
    create: (input) => ipcRenderer.invoke('servers:create', input),
    update: (id, input) => ipcRenderer.invoke('servers:update', id, input),
    delete: (id) => ipcRenderer.invoke('servers:delete', id) as Promise<void>,
    testConnection: (input) => ipcRenderer.invoke('servers:test-connection', input),
  },
  pipelines: {
    tree: () => ipcRenderer.invoke('pipelines:tree'),
    search: (query) => ipcRenderer.invoke('pipelines:search', query),
    createFolder: (input) => ipcRenderer.invoke('folders:create', input),
    renameFolder: (id, name) => ipcRenderer.invoke('folders:rename', id, name),
    deleteFolder: (id) => ipcRenderer.invoke('folders:delete', id) as Promise<void>,
    createPipeline: (input) => ipcRenderer.invoke('pipelines:create', input),
    renamePipeline: (id, name) => ipcRenderer.invoke('pipelines:rename', id, name),
    getPipelineDeleteImpact: (id) => ipcRenderer.invoke('pipelines:delete-impact', id),
    deletePipeline: (id) => ipcRenderer.invoke('pipelines:delete', id) as Promise<void>,
    getGraph: (pipelineId) => ipcRenderer.invoke('pipelines:get-graph', pipelineId),
    saveGraph: (pipelineId, graph) => ipcRenderer.invoke('pipelines:save-graph', pipelineId, graph) as Promise<void>,
    updateParameters: (pipelineId, parameters) => ipcRenderer.invoke('pipelines:update-parameters', pipelineId, parameters),
  },
  commands: {
    list: (unitId) => ipcRenderer.invoke('commands:list', unitId),
    save: (unitId, commands) => ipcRenderer.invoke('commands:save', unitId, commands) as Promise<void>,
    delete: (id) => ipcRenderer.invoke('commands:delete', id) as Promise<void>,
    reorder: (unitId, orderedIds) => ipcRenderer.invoke('commands:reorder', unitId, orderedIds) as Promise<void>,
  },
  runs: {
    start: (pipelineId, parameters) => ipcRenderer.invoke('runs:start', pipelineId, parameters),
    onEvent: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
      ipcRenderer.on('runs:event', listener);
      return () => ipcRenderer.removeListener('runs:event', listener);
    },
  },
};

contextBridge.exposeInMainWorld('autoPipeline', api);
