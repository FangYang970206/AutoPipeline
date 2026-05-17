import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { InMemoryCredentialStore } from './server/credentialStore';
import { migrateServerSchema } from './server/schema';
import { ServerRepository, ServerInUseError } from './server/serverRepository';

function createRepository(referencingPipelines: string[] = []) {
  const db = new Database(':memory:');
  migrateServerSchema(db);
  const credentials = new InMemoryCredentialStore();
  const repository = new ServerRepository(db, credentials, {
    findPipelineNamesUsingServer: () => referencingPipelines,
  });

  return { db, credentials, repository };
}

describe('ServerRepository', () => {
  it('stores server fields while keeping secrets out of SQLite', async () => {
    const { db, credentials, repository } = createRepository();

    const server = await repository.create({
      displayName: 'Production',
      host: 'prod.example.com',
      port: 22,
      username: 'deploy',
      authMethod: 'password',
      password: 'super-secret',
      connectionTimeout: 30,
      keepaliveInterval: 15,
      defaultDirectory: '/srv/app',
      notes: 'Primary deployment target',
    });

    expect(server.id).toBeGreaterThan(0);
    expect(await credentials.getPassword(server.id)).toBe('super-secret');
    expect(repository.list()).toEqual([
      expect.objectContaining({
        displayName: 'Production',
        host: 'prod.example.com',
        username: 'deploy',
        authMethod: 'password',
      }),
    ]);
    expect(JSON.stringify(db.prepare('select * from servers').get())).not.toContain('super-secret');
  });

  it('blocks deleting a server while pipelines reference it', async () => {
    const { repository } = createRepository(['Deploy API', 'Refresh Cache']);
    const server = await repository.create({
      displayName: 'Shared',
      host: 'shared.example.com',
      port: 22,
      username: 'ops',
      authMethod: 'key',
      keyPath: 'C:/Users/Lenovo/.ssh/id_rsa',
      keyPassphrase: 'secret-passphrase',
      connectionTimeout: 20,
      keepaliveInterval: 10,
      defaultDirectory: '/opt',
      notes: '',
    });

    await expect(repository.delete(server.id)).rejects.toThrow(ServerInUseError);
    await expect(repository.delete(server.id)).rejects.toThrow('Deploy API, Refresh Cache');
  });
});
