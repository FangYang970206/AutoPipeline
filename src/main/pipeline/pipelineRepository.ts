import type { Database } from 'better-sqlite3';
import type { FolderRecord, PipelineRecord, PipelineTreeFolder } from './types.js';

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

  getPipelineDeleteImpact(id: number): { runCount: number } {
    return this.db.prepare('select count(*) as runCount from runs where pipeline_id = ?').get(id) as { runCount: number };
  }

  deletePipeline(id: number): void {
    this.db.prepare('delete from pipelines where id = ?').run(id);
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
