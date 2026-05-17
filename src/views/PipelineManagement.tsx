import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import type { PipelineRecord, PipelineTreeFolder } from '../types';
import { DagEditor } from './DagEditor';

export function PipelineManagement() {
  const api = window.autoPipeline?.pipelines;
  const [tree, setTree] = useState<PipelineTreeFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [folderName, setFolderName] = useState('');
  const [pipelineName, setPipelineName] = useState('');
  const [selectedPipeline, setSelectedPipeline] = useState<PipelineRecord | null>(null);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    void reload();
  }, []);

  async function reload() {
    if (!api) {
      return;
    }
    setTree(query.trim() ? await api.search(query) : await api.tree());
  }

  async function createFolder() {
    if (!api || !folderName.trim()) {
      return;
    }
    const folder = await api.createFolder({ name: folderName, parentId: null });
    setSelectedFolderId(folder.id);
    setFolderName('');
    setMessage('文件夹已创建');
    await reload();
  }

  async function createPipeline() {
    if (!api || !pipelineName.trim()) {
      return;
    }
    await api.createPipeline({ name: pipelineName, folderId: selectedFolderId });
    setPipelineName('');
    setMessage('Pipeline 已创建');
    await reload();
  }

  async function renameFolder(folder: PipelineTreeFolder) {
    const name = window.prompt('重命名文件夹', folder.name);
    if (!api || !name) {
      return;
    }
    await api.renameFolder(folder.id, name);
    await reload();
  }

  async function deleteFolder(folder: PipelineTreeFolder) {
    if (!api || !window.confirm(`删除文件夹 ${folder.name}?`)) {
      return;
    }
    await api.deleteFolder(folder.id);
    if (selectedFolderId === folder.id) {
      setSelectedFolderId(null);
    }
    await reload();
  }

  async function renamePipeline(pipeline: PipelineRecord) {
    const name = window.prompt('重命名 Pipeline', pipeline.name);
    if (!api || !name) {
      return;
    }
    await api.renamePipeline(pipeline.id, name);
    await reload();
  }

  async function deletePipeline(pipeline: PipelineRecord) {
    if (!api) {
      return;
    }
    const impact = await api.getPipelineDeleteImpact(pipeline.id);
    if (!window.confirm(`删除 Pipeline ${pipeline.name}? 将删除 ${impact.runCount} 条运行记录。`)) {
      return;
    }
    await api.deletePipeline(pipeline.id);
    if (selectedPipeline?.id === pipeline.id) {
      setSelectedPipeline(null);
    }
    await reload();
  }

  async function search(nextQuery: string) {
    setQuery(nextQuery);
    if (!api) {
      return;
    }
    setTree(nextQuery.trim() ? await api.search(nextQuery) : await api.tree());
  }

  return (
    <div className="grid max-w-6xl grid-cols-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="space-y-4">
        <label className="grid gap-1 text-sm text-slate-300">
          <span>搜索 Pipeline</span>
          <input className={inputClass} value={query} onChange={(event) => void search(event.target.value)} />
        </label>
        <div className="rounded-md border border-border bg-slate-900 p-4">
          <h2 className="mb-3 text-lg font-semibold">新建</h2>
          <label className="grid gap-1 text-sm text-slate-300">
            <span>文件夹名称</span>
            <input className={inputClass} value={folderName} onChange={(event) => setFolderName(event.target.value)} />
          </label>
          <Button className="mt-2 w-full" onClick={() => void createFolder()} type="button">
            创建文件夹
          </Button>
          <label className="mt-4 grid gap-1 text-sm text-slate-300">
            <span>Pipeline 名称</span>
            <input className={inputClass} value={pipelineName} onChange={(event) => setPipelineName(event.target.value)} />
          </label>
          <Button className="mt-2 w-full" onClick={() => void createPipeline()} type="button">
            创建 Pipeline
          </Button>
          <p aria-live="polite" className="mt-3 min-h-5 text-sm text-slate-300">
            {message}
          </p>
        </div>
      </aside>
      <section className="min-w-0">
        {selectedPipeline ? <DagEditor pipeline={selectedPipeline} /> : <h2 className="mb-3 text-xl font-semibold">Pipeline</h2>}
        <div className={selectedPipeline ? 'mt-4 space-y-3' : 'space-y-3'}>
          {tree.map((folder) => (
            <FolderNode
              folder={folder}
              key={folder.id}
              onDeleteFolder={deleteFolder}
              onDeletePipeline={deletePipeline}
              onRenameFolder={renameFolder}
              onRenamePipeline={renamePipeline}
              onSelectPipeline={setSelectedPipeline}
              onSelectFolder={setSelectedFolderId}
              selectedFolderId={selectedFolderId}
            />
          ))}
          {tree.length === 0 ? <p className="rounded-md border border-border p-6 text-center text-slate-400">暂无 Pipeline</p> : null}
        </div>
      </section>
    </div>
  );
}

function FolderNode({
  folder,
  onDeleteFolder,
  onDeletePipeline,
  onRenameFolder,
  onRenamePipeline,
  onSelectPipeline,
  onSelectFolder,
  selectedFolderId,
}: {
  folder: PipelineTreeFolder;
  onDeleteFolder: (folder: PipelineTreeFolder) => Promise<void>;
  onDeletePipeline: (pipeline: PipelineRecord) => Promise<void>;
  onRenameFolder: (folder: PipelineTreeFolder) => Promise<void>;
  onRenamePipeline: (pipeline: PipelineRecord) => Promise<void>;
  onSelectPipeline: (pipeline: PipelineRecord) => void;
  onSelectFolder: (id: number) => void;
  selectedFolderId: number | null;
}) {
  const selected = selectedFolderId === folder.id;
  return (
    <div className="rounded-md border border-border bg-slate-900">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <button className={selected ? 'font-semibold text-accent' : 'font-semibold text-white'} onClick={() => onSelectFolder(folder.id)} type="button">
          {folder.name}
        </button>
        <div className="flex gap-2">
          <Button onClick={() => void onRenameFolder(folder)} type="button" variant="ghost">
            重命名
          </Button>
          <Button onClick={() => void onDeleteFolder(folder)} type="button" variant="ghost">
            删除
          </Button>
        </div>
      </div>
      <div className="space-y-1 p-2">
        {folder.pipelines.map((pipeline) => (
          <div className="flex items-center justify-between rounded-md px-2 py-1 hover:bg-slate-800" key={pipeline.id}>
            <button onClick={() => onSelectPipeline(pipeline)} type="button">
              {pipeline.name}
            </button>
            <div className="flex gap-2">
              <Button onClick={() => void onRenamePipeline(pipeline)} type="button" variant="ghost">
                重命名
              </Button>
              <Button onClick={() => void onDeletePipeline(pipeline)} type="button" variant="ghost">
                删除
              </Button>
            </div>
          </div>
        ))}
        {folder.folders.map((child) => (
          <FolderNode
            folder={child}
            key={child.id}
            onDeleteFolder={onDeleteFolder}
            onDeletePipeline={onDeletePipeline}
            onRenameFolder={onRenameFolder}
            onRenamePipeline={onRenamePipeline}
            onSelectPipeline={onSelectPipeline}
            onSelectFolder={onSelectFolder}
            selectedFolderId={selectedFolderId}
          />
        ))}
      </div>
    </div>
  );
}

const inputClass =
  'h-9 rounded-md border border-border bg-slate-950 px-3 text-sm text-white outline-none focus:border-accent';
