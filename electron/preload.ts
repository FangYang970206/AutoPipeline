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
  },
};

contextBridge.exposeInMainWorld('autoPipeline', api);
