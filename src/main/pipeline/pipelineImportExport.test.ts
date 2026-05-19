import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { CommandRepository } from '../command/commandRepository';
import { InMemoryCredentialStore } from '../server/credentialStore';
import { ServerRepository } from '../server/serverRepository';
import { migrateServerSchema } from '../server/schema';
import { migratePipelineSchema } from './schema';
import { PipelineRepository } from './pipelineRepository';
import { PipelineImportExportService } from './pipelineImportExport';

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = on');
  migrateServerSchema(db);
  migratePipelineSchema(db);
  const servers = new ServerRepository(db, new InMemoryCredentialStore(), { findPipelineNamesUsingServer: () => [] });
  const pipelines = new PipelineRepository(db);
  const commands = new CommandRepository(db);
  const service = new PipelineImportExportService(db);
  return { commands, db, pipelines, servers, service };
}

describe('PipelineImportExportService', () => {
  it('exports a pipeline as JSON using names instead of IDs or credentials', async () => {
    const { commands, pipelines, servers, service } = setup();
    const server = await servers.create({
      displayName: 'Prod',
      host: 'prod.example.com',
      port: 22,
      username: 'deploy',
      authMethod: 'password',
      password: 'secret',
      connectionTimeout: 30,
      keepaliveInterval: 15,
    });
    const pipeline = pipelines.createPipeline({ name: 'Deploy API', folderId: null });
    pipelines.updateParameters(pipeline.id, [{ name: 'env', type: 'string', defaultValue: 'prod' }]);
    pipelines.savePipelineGraph(pipeline.id, {
      units: [
        { id: 'unit-build', name: 'Build', position: { x: 0, y: 0 } },
        { id: 'unit-deploy', name: 'Deploy', position: { x: 200, y: 0 } },
      ],
      edges: [{ source: 'unit-build', target: 'unit-deploy' }],
    });
    commands.saveCommands('unit-deploy', [
      { id: 'cmd-deploy', type: 'shell', order: 0, config: { name: 'Deploy', script: 'deploy {{params.env}}', serverId: server.id, shellType: 'cmd', onFailure: 'stop' } },
    ]);

    const exported = service.exportPipeline(pipeline.id);
    const json = JSON.stringify(exported);

    expect(exported).toMatchObject({
      pipeline: { name: 'Deploy API', parameters: [{ name: 'env' }] },
      executionUnits: [
        { name: 'Build' },
        { name: 'Deploy', commands: [expect.objectContaining({ config: expect.objectContaining({ serverName: 'Prod' }) })] },
      ],
      dagEdges: [{ source: 'Build', target: 'Deploy' }],
    });
    expect(json).not.toContain('unit-build');
    expect(json).not.toContain('cmd-deploy');
    expect(json).not.toContain('secret');
    expect(json).not.toContain('serverId');
  });

  it('imports a pipeline with server mapping and can round-trip equivalent JSON', async () => {
    const { servers, service } = setup();
    await servers.create({
      displayName: 'Production',
      host: 'prod.example.com',
      port: 22,
      username: 'deploy',
      authMethod: 'password',
      password: 'secret',
      connectionTimeout: 30,
      keepaliveInterval: 15,
    });
    const document = {
      version: 1,
      pipeline: { name: 'Deploy API', parameters: [], shellSessions: [] },
      executionUnits: [
        {
          name: 'Deploy',
          position: { x: 0, y: 0 },
          commands: [
            { type: 'shell', order: 0, config: { name: 'Deploy', script: 'deploy', shellType: 'cmd', onFailure: 'stop', serverName: 'Prod' } },
          ],
        },
      ],
      dagEdges: [],
    };

    const imported = service.importPipeline(document, { serverMappings: { Prod: 'Production' } });
    const exported = service.exportPipeline(imported.id);

    expect(exported).toEqual({
      ...document,
      executionUnits: [
        {
          name: 'Deploy',
          position: { x: 0, y: 0 },
          commands: [
            { type: 'shell', order: 0, config: { name: 'Deploy', script: 'deploy', shellType: 'cmd', onFailure: 'stop', serverName: 'Production' } },
          ],
        },
      ],
    });
  });

  it('rejects malformed JSON and reports unknown servers before import', () => {
    const { service } = setup();
    const document = {
      version: 1,
      pipeline: { name: 'Deploy API', parameters: [], shellSessions: [] },
      executionUnits: [
        { name: 'Deploy', position: { x: 0, y: 0 }, commands: [{ type: 'shell', order: 0, config: { name: 'Deploy', script: 'deploy', shellType: 'cmd', onFailure: 'stop', serverName: 'Prod' } }] },
      ],
      dagEdges: [],
    };

    expect(() => service.importPipeline({ nope: true })).toThrow('Malformed pipeline export JSON');
    expect(() =>
      service.importPipeline({
        version: 1,
        pipeline: { name: 'Deploy API', parameters: [], shellSessions: [] },
        executionUnits: [{ name: 'Deploy', position: { x: 0, y: 0 }, commands: [{ type: 'shell', order: 0 }] }],
        dagEdges: [],
      }),
    ).toThrow('Malformed command in execution unit: Deploy');
    expect(service.findUnknownServers(document)).toEqual(['Prod']);
    expect(() => service.importPipeline(document)).toThrow('Unknown server: Prod');
  });

  it('handles duplicate pipeline names by rename or overwrite', () => {
    const { pipelines, service, db } = setup();
    pipelines.createPipeline({ name: 'Deploy API', folderId: null });
    const document = {
      version: 1,
      pipeline: { name: 'Deploy API', parameters: [], shellSessions: [] },
      executionUnits: [{ name: 'Build', position: { x: 0, y: 0 }, commands: [] }],
      dagEdges: [],
    };

    expect(() => service.importPipeline(document)).toThrow('Pipeline already exists: Deploy API');
    expect(service.importPipeline(document, { duplicateName: { mode: 'rename', name: 'Deploy API Copy' } }).name).toBe('Deploy API Copy');
    expect(() => service.importPipeline(document, { duplicateName: { mode: 'rename', name: 'Deploy API Copy' } })).toThrow('Pipeline already exists: Deploy API Copy');
    service.importPipeline(document, { duplicateName: { mode: 'overwrite' } });

    expect(db.prepare("select count(*) as count from pipelines where name = 'Deploy API'").get()).toEqual({ count: 1 });
  });

  it('rejects dangling DAG edges instead of exporting internal unit ids', () => {
    const { db, pipelines, service } = setup();
    const pipeline = pipelines.createPipeline({ name: 'Deploy API', folderId: null });
    pipelines.savePipelineGraph(pipeline.id, {
      units: [{ id: 'unit-build', name: 'Build', position: { x: 0, y: 0 } }],
      edges: [],
    });
    db.prepare('update pipelines set dag_edges = ? where id = ?').run(JSON.stringify([{ source: 'unit-build', target: 'unit-missing' }]), pipeline.id);

    expect(() => service.exportPipeline(pipeline.id)).toThrow('Cannot export dangling DAG edge: unit-build -> unit-missing');
  });
});
