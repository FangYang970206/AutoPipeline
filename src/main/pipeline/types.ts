export interface FolderRecord {
  id: number;
  name: string;
  parentId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineRecord {
  id: number;
  name: string;
  folderId: number | null;
  dagEdges: unknown[];
  createdAt: string;
  updatedAt: string;
}

export interface PipelineTreeFolder extends FolderRecord {
  folders: PipelineTreeFolder[];
  pipelines: PipelineRecord[];
}
