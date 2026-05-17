export type ViewId = 'pipelines' | 'fileBrowser' | 'servers' | 'settings';

export interface AutoPipelineApi {
  app: {
    getVersion: () => Promise<string>;
    ping: () => Promise<'pong'>;
  };
}

declare global {
  interface Window {
    autoPipeline?: AutoPipelineApi;
  }
}
