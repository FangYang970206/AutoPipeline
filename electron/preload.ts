import { contextBridge, ipcRenderer } from 'electron';

interface AutoPipelineApi {
  app: {
    getVersion: () => Promise<string>;
    ping: () => Promise<'pong'>;
  };
}

const api: AutoPipelineApi = {
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version') as Promise<string>,
    ping: () => ipcRenderer.invoke('app:ping') as Promise<'pong'>,
  },
};

contextBridge.exposeInMainWorld('autoPipeline', api);
