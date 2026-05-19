import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { CommandConfig, CommandInput } from '../command/types.js';
import { CommandRepository } from '../command/commandRepository.js';
import { PipelineRepository } from './pipelineRepository.js';
import type { PipelineParameter } from './types.js';

export interface PipelineExportDocument {
  version: 1;
  pipeline: {
    name: string;
    parameters: PipelineParameter[];
    shellSessions: string[];
  };
  executionUnits: Array<{
    name: string;
    position: { x: number; y: number };
    commands: Array<{
      type: 'shell' | 'transfer';
      order: number;
      config: Record<string, unknown>;
    }>;
  }>;
  dagEdges: Array<{ source: string; target: string }>;
}

export interface ImportPipelineOptions {
  serverMappings?: Record<string, string>;
  duplicateName?: { mode: 'rename'; name: string } | { mode: 'overwrite' };
}

export class PipelineImportExportService {
  private readonly pipelines: PipelineRepository;
  private readonly commands: CommandRepository;

  constructor(private readonly db: Database) {
    this.pipelines = new PipelineRepository(db);
    this.commands = new CommandRepository(db);
  }

  exportPipeline(pipelineId: number): PipelineExportDocument {
    const pipeline = this.pipelines.getPipeline(pipelineId);
    const graph = this.pipelines.getPipelineGraph(pipelineId);
    const serverNames = this.getServerNamesById();
    return {
      version: 1,
      pipeline: {
        name: pipeline.name,
        parameters: pipeline.parameters,
        shellSessions: pipeline.shellSessions,
      },
      executionUnits: graph.units.map((unit) => ({
        name: unit.name,
        position: unit.position,
        commands: this.commands.listCommands(unit.id).map((command) => ({
          type: command.type,
          order: command.order,
          config: exportCommandConfig(command.config, serverNames),
        })),
      })),
      dagEdges: graph.edges.map((edge) => {
        const source = graph.units.find((unit) => unit.id === edge.source)?.name;
        const target = graph.units.find((unit) => unit.id === edge.target)?.name;
        if (!source || !target) {
          throw new Error(`Cannot export dangling DAG edge: ${edge.source} -> ${edge.target}`);
        }
        return { source, target };
      }),
    };
  }

  importPipeline(document: unknown, options: ImportPipelineOptions = {}) {
    const parsed = parseExportDocument(document);
    const serverIds = this.resolveServerIds(parsed, options.serverMappings ?? {});
    const name = this.resolvePipelineName(parsed.pipeline.name, options.duplicateName);
    const importPipeline = this.db.transaction(() => {
      if (options.duplicateName?.mode === 'overwrite') {
        const existing = this.findPipelineByName(parsed.pipeline.name);
        if (existing) {
          this.pipelines.deletePipeline(existing.id);
        }
      }
      const pipeline = this.pipelines.createPipeline({ name, folderId: null });
      this.pipelines.updateParameters(pipeline.id, parsed.pipeline.parameters);
      this.pipelines.updateShellSessions(pipeline.id, parsed.pipeline.shellSessions);
      const units = parsed.executionUnits.map((unit) => ({
        id: `unit-${randomUUID()}`,
        name: unit.name,
        position: unit.position,
      }));
      const unitIdByName = new Map(units.map((unit) => [unit.name, unit.id]));
      this.pipelines.savePipelineGraph(pipeline.id, {
        units,
        edges: parsed.dagEdges.map((edge) => ({
          source: unitIdByName.get(edge.source)!,
          target: unitIdByName.get(edge.target)!,
        })),
      });
      for (const unit of parsed.executionUnits) {
        this.commands.saveCommands(unitIdByName.get(unit.name)!, unit.commands.map((command) => ({
          id: `cmd-${randomUUID()}`,
          type: command.type,
          order: command.order,
          config: importCommandConfig(command.config, serverIds),
        } as CommandInput)));
      }
      return this.pipelines.getPipeline(pipeline.id);
    });
    return importPipeline();
  }

  findUnknownServers(document: unknown) {
    const parsed = parseExportDocument(document);
    const localNames = new Set(this.listServerNames());
    return Array.from(collectServerNames(parsed)).filter((name) => !localNames.has(name));
  }

  private resolvePipelineName(name: string, duplicateName: ImportPipelineOptions['duplicateName']) {
    const existing = this.findPipelineByName(name);
    if (!existing || duplicateName?.mode === 'overwrite') {
      return name;
    }
    if (duplicateName?.mode === 'rename') {
      const nextName = requireName(duplicateName.name);
      if (this.findPipelineByName(nextName)) {
        throw new Error(`Pipeline already exists: ${nextName}`);
      }
      return nextName;
    }
    throw new Error(`Pipeline already exists: ${name}`);
  }

  private resolveServerIds(document: PipelineExportDocument, mappings: Record<string, string>) {
    const servers = new Map(this.db.prepare('select id, display_name as displayName from servers').all().map((row) => {
      const server = row as { id: number; displayName: string };
      return [server.displayName, server.id] as const;
    }));
    const resolved = new Map<string, number>();
    for (const serverName of collectServerNames(document)) {
      const localName = mappings[serverName] ?? serverName;
      const id = servers.get(localName);
      if (id === undefined) {
        throw new Error(`Unknown server: ${serverName}`);
      }
      resolved.set(serverName, id);
    }
    return resolved;
  }

  private findPipelineByName(name: string) {
    return this.db.prepare('select id, name from pipelines where name = ? collate nocase').get(name) as { id: number; name: string } | undefined;
  }

  private getServerNamesById() {
    return new Map(this.db.prepare('select id, display_name as displayName from servers').all().map((row) => {
      const server = row as { id: number; displayName: string };
      return [server.id, server.displayName] as const;
    }));
  }

  private listServerNames() {
    return (this.db.prepare('select display_name as displayName from servers').all() as Array<{ displayName: string }>).map((server) => server.displayName);
  }
}

function exportCommandConfig(config: CommandConfig, serverNames: Map<number, string>) {
  if ('serverId' in config) {
    const { serverId, ...rest } = config;
    return { ...rest, serverName: serverId === null ? null : serverNames.get(serverId) ?? null };
  }
  return config as unknown as Record<string, unknown>;
}

function importCommandConfig(config: Record<string, unknown>, serverIds: Map<string, number>): CommandConfig {
  const { serverName, ...rest } = config;
  const serverId = typeof serverName === 'string' ? serverIds.get(serverName) ?? null : null;
  return { ...rest, serverId } as unknown as CommandConfig;
}

function parseExportDocument(document: unknown): PipelineExportDocument {
  if (!document || typeof document !== 'object') {
    throw new Error('Import file must contain a pipeline export object');
  }
  const data = document as PipelineExportDocument;
  if (data.version !== 1 || !data.pipeline || !Array.isArray(data.executionUnits) || !Array.isArray(data.dagEdges)) {
    throw new Error('Malformed pipeline export JSON');
  }
  data.pipeline.name = requireName(data.pipeline.name);
  data.pipeline.parameters = Array.isArray(data.pipeline.parameters) ? data.pipeline.parameters : [];
  data.pipeline.shellSessions = Array.isArray(data.pipeline.shellSessions) ? data.pipeline.shellSessions : [];
  const unitNames = new Set<string>();
  for (const unit of data.executionUnits) {
    unit.name = requireName(unit.name);
    if (unitNames.has(unit.name)) {
      throw new Error(`Duplicate execution unit: ${unit.name}`);
    }
    unitNames.add(unit.name);
    if (!unit.position || typeof unit.position.x !== 'number' || typeof unit.position.y !== 'number' || !Array.isArray(unit.commands)) {
      throw new Error(`Malformed execution unit: ${unit.name}`);
    }
    for (const command of unit.commands) {
      if (command.type !== 'shell' && command.type !== 'transfer') {
        throw new Error(`Malformed command in execution unit: ${unit.name}`);
      }
      if (!Number.isInteger(command.order) || command.order < 0 || !command.config || typeof command.config !== 'object' || Array.isArray(command.config)) {
        throw new Error(`Malformed command in execution unit: ${unit.name}`);
      }
      if (typeof command.config.name !== 'string' || !command.config.name.trim()) {
        throw new Error(`Command name is required in execution unit: ${unit.name}`);
      }
      if (command.type === 'shell') {
        if (typeof command.config.script !== 'string' || (command.config.shellType !== 'cmd' && command.config.shellType !== 'powershell')) {
          throw new Error(`Malformed shell command in execution unit: ${unit.name}`);
        }
        if (!['stop', 'continue', 'skip_unit'].includes(String(command.config.onFailure))) {
          throw new Error(`Malformed shell command in execution unit: ${unit.name}`);
        }
      }
      if (command.type === 'transfer') {
        if (typeof command.config.source !== 'string' || typeof command.config.destination !== 'string') {
          throw new Error(`Malformed transfer command in execution unit: ${unit.name}`);
        }
        if (!['upload', 'download'].includes(String(command.config.direction)) || !['overwrite', 'skip', 'error'].includes(String(command.config.overwriteMode))) {
          throw new Error(`Malformed transfer command in execution unit: ${unit.name}`);
        }
      }
    }
  }
  for (const edge of data.dagEdges) {
    if (!unitNames.has(edge.source) || !unitNames.has(edge.target)) {
      throw new Error(`DAG edge references an unknown execution unit: ${edge.source} -> ${edge.target}`);
    }
  }
  return data;
}

function collectServerNames(document: PipelineExportDocument) {
  const names = new Set<string>();
  for (const unit of document.executionUnits) {
    for (const command of unit.commands) {
      const serverName = command.config?.serverName;
      if (typeof serverName === 'string' && serverName.trim()) {
        names.add(serverName);
      }
    }
  }
  return names;
}

function requireName(name: unknown) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('Name is required');
  }
  return name.trim();
}
