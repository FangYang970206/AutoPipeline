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
};

contextBridge.exposeInMainWorld('autoPipeline', api);
