import type { Database } from 'better-sqlite3';
import { renameUnitReferences } from '../execution/namedOutputs.js';
import type { FolderRecord, PipelineGraph, PipelineParameter, PipelineRecord, PipelineTreeFolder } from './types.js';

interface FolderRow {
  id: number;
  name: string;
  parent_id: number | null;
  created_at: string;
  updated_at: string;
}

interface PipelineRow {
  id: number;
  name: string;
  folder_id: number | null;
  dag_edges: string;
  parameters: string;
  created_at: string;
  updated_at: string;
}

export class PipelineRepository {
  constructor(private readonly db: Database) {}

  createFolder(input: { name: string; parentId: number | null }): FolderRecord {
    const result = this.db
      .prepare('insert into folders (name, parent_id) values (?, ?)')
      .run(requireName(input.name), input.parentId);
    return this.getFolder(Number(result.lastInsertRowid));
  }

  renameFolder(id: number, name: string): FolderRecord {
    this.db.prepare('update folders set name = ?, updated_at = current_timestamp where id = ?').run(requireName(name), id);
    return this.getFolder(id);
  }

  deleteFolder(id: number): void {
    this.db.prepare('delete from folders where id = ?').run(id);
  }

  createPipeline(input: { name: string; folderId: number | null }): PipelineRecord {
    const result = this.db
      .prepare('insert into pipelines (name, folder_id, dag_edges) values (?, ?, ?)')
      .run(requireName(input.name), input.folderId, '[]');
    return this.getPipeline(Number(result.lastInsertRowid));
  }

  renamePipeline(id: number, name: string): PipelineRecord {
    this.db.prepare('update pipelines set name = ?, updated_at = current_timestamp where id = ?').run(requireName(name), id);
    return this.getPipeline(id);
  }

  updateParameters(id: number, parameters: PipelineParameter[]): PipelineRecord {
    validateParameters(parameters);
    this.db
      .prepare('update pipelines set parameters = ?, updated_at = current_timestamp where id = ?')
      .run(JSON.stringify(parameters), id);
    return this.getPipeline(id);
  }

  getPipelineDeleteImpact(id: number): { runCount: number } {
    return this.db.prepare('select count(*) as runCount from runs where pipeline_id = ?').get(id) as { runCount: number };
  }

  deletePipeline(id: number): void {
    this.db.prepare('delete from pipelines where id = ?').run(id);
  }

  savePipelineGraph(pipelineId: number, graph: PipelineGraph): void {
    const previousUnits = this.db
      .prepare('select id, name from execution_units where pipeline_id = ?')
      .all(pipelineId) as Array<{ id: string; name: string }>;
    const save = this.db.transaction(() => {
      const nextIds = new Set(graph.units.map((unit) => unit.id));
      for (const previousUnit of previousUnits) {
        if (!nextIds.has(previousUnit.id)) {
          this.db.prepare('delete from execution_units where id = ?').run(previousUnit.id);
        }
      }
      const insert = this.db.prepare(
        `insert into execution_units (id, pipeline_id, name, position)
         values (?, ?, ?, ?)
         on conflict(id) do update set name = excluded.name, position = excluded.position`,
      );
      for (const unit of graph.units) {
        insert.run(unit.id, pipelineId, unit.name, JSON.stringify(unit.position));
        const previous = previousUnits.find((item) => item.id === unit.id);
        if (previous && previous.name !== unit.name) {
          this.updateShellScriptsInPipeline(pipelineId, (script) => renameUnitReferences(script, previous.name, unit.name));
        }
      }
      this.db
        .prepare('update pipelines set dag_edges = ?, updated_at = current_timestamp where id = ?')
        .run(JSON.stringify(graph.edges), pipelineId);
    });

    save();
  }

  private updateShellScriptsInPipeline(pipelineId: number, rewrite: (script: string) => string) {
    const rows = this.db
      .prepare(
        `select commands.id, commands.config
           from commands
           join execution_units on execution_units.id = commands.unit_id
          where execution_units.pipeline_id = ? and commands.type = 'shell'`,
      )
      .all(pipelineId) as Array<{ id: string; config: string }>;
    const update = this.db.prepare('update commands set config = ? where id = ?');
    for (const row of rows) {
      const config = JSON.parse(row.config) as { script: string };
      const nextScript = rewrite(config.script);
      if (nextScript !== config.script) {
        update.run(JSON.stringify({ ...config, script: nextScript }), row.id);
      }
    }
  }

  getPipelineGraph(pipelineId: number): PipelineGraph {
    const pipeline = this.getPipeline(pipelineId);
    const units = this.db
      .prepare('select id, name, position from execution_units where pipeline_id = ? order by rowid')
      .all(pipelineId)
      .map((row) => {
        const unit = row as { id: string; name: string; position: string };
        return { id: unit.id, name: unit.name, position: JSON.parse(unit.position) as { x: number; y: number } };
      });

    return { units, edges: pipeline.dagEdges as Array<{ source: string; target: string }> };
  }

  getTree(): PipelineTreeFolder[] {
    return this.buildTree(this.listFolders(), this.listPipelines(), true);
  }

  search(query: string): PipelineTreeFolder[] {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) {
      return this.getTree();
    }

    const folders = this.listFolders();
    const pipelines = this.listPipelines().filter((pipeline) => pipeline.name.toLocaleLowerCase().includes(normalized));
    return this.buildTree(folders, pipelines, false);
  }

  private getFolder(id: number): FolderRecord {
    const row = this.db.prepare('select * from folders where id = ?').get(id) as FolderRow | undefined;
    if (!row) {
      throw new Error(`Folder not found: ${id}`);
    }
    return mapFolder(row);
  }

  private getPipeline(id: number): PipelineRecord {
    const row = this.db.prepare('select * from pipelines where id = ?').get(id) as PipelineRow | undefined;
    if (!row) {
      throw new Error(`Pipeline not found: ${id}`);
    }
    return mapPipeline(row);
  }

  private listFolders(): FolderRecord[] {
    return this.db
      .prepare('select * from folders order by name collate nocase')
      .all()
      .map((row) => mapFolder(row as FolderRow));
  }

  private listPipelines(): PipelineRecord[] {
    return this.db
      .prepare('select * from pipelines order by name collate nocase')
      .all()
      .map((row) => mapPipeline(row as PipelineRow));
  }

  private buildTree(folders: FolderRecord[], pipelines: PipelineRecord[], includeEmpty: boolean): PipelineTreeFolder[] {
    const byId = new Map<number, PipelineTreeFolder>();
    for (const folder of folders) {
      byId.set(folder.id, { ...folder, folders: [], pipelines: [] });
    }

    for (const pipeline of pipelines) {
      if (pipeline.folderId !== null && byId.has(pipeline.folderId)) {
        byId.get(pipeline.folderId)!.pipelines.push(pipeline);
      }
    }

    const roots: PipelineTreeFolder[] = [];
    for (const folder of byId.values()) {
      if (folder.parentId !== null && byId.has(folder.parentId)) {
        byId.get(folder.parentId)!.folders.push(folder);
      } else {
        roots.push(folder);
      }
    }

    return includeEmpty ? roots : roots.filter((folder) => folder.pipelines.length > 0 || folder.folders.length > 0);
  }
}

function requireName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Name is required');
  }
  return trimmed;
}

function mapFolder(row: FolderRow): FolderRecord {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPipeline(row: PipelineRow): PipelineRecord {
  return {
    id: row.id,
    name: row.name,
    folderId: row.folder_id,
    dagEdges: JSON.parse(row.dag_edges) as unknown[],
    parameters: JSON.parse(row.parameters ?? '[]') as PipelineParameter[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateParameters(parameters: PipelineParameter[]) {
  const names = new Set<string>();
  for (const parameter of parameters) {
    const name = parameter.name.trim();
    if (!name) {
      throw new Error('Parameter name is required');
    }
    if (names.has(name)) {
      throw new Error(`Duplicate parameter: ${name}`);
    }
    names.add(name);
    if (parameter.type === 'select' && (!parameter.options || parameter.options.length === 0)) {
      throw new Error(`Select parameter requires options: ${name}`);
    }
  }
}
