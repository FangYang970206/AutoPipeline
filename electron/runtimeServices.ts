import { CommandRepository } from '../src/main/command/commandRepository.js';
import { SshConnectionPool } from '../src/main/execution/sshConnectionPool.js';
import { PipelineRepository } from '../src/main/pipeline/pipelineRepository.js';
import { KeytarCredentialStore } from '../src/main/server/credentialStore.js';
import { ServerRepository } from '../src/main/server/serverRepository.js';
import { AppSettingsRepository, type AppSettings } from '../src/main/settings/appSettings.js';
import { getDatabase } from './database.js';

let services: RuntimeServices | undefined;

export interface RuntimeServices {
  db: ReturnType<typeof getDatabase>;
  commands: CommandRepository;
  credentials: KeytarCredentialStore;
  pipelines: PipelineRepository;
  servers: ServerRepository;
  settings: AppSettingsRepository;
  sshPool: SshConnectionPool;
}

export function getRuntimeServices(): RuntimeServices {
  if (!services) {
    const db = getDatabase();
    const credentials = new KeytarCredentialStore();
    const settings = new AppSettingsRepository(db);
    services = {
      db,
      commands: new CommandRepository(db),
      credentials,
      pipelines: new PipelineRepository(db),
      servers: new ServerRepository(db, credentials, { findPipelineNamesUsingServer: () => [] }),
      settings,
      sshPool: new SshConnectionPool(credentials, toPoolOptions(settings.getAll())),
    };
  }

  return services;
}

export function toPoolOptions(settings: AppSettings) {
  return {
    idleTimeoutMs: settings.connectionPool.idleTimeoutMinutes * 60 * 1000,
    maxConnections: settings.connectionPool.maxConnections,
  };
}
