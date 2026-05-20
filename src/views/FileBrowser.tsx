import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Download, FolderPlus, RefreshCw, Trash2, Upload, CornerUpLeft, Pencil } from 'lucide-react';
import { Button } from '../components/ui/button';
import type { FileBrowserEntry, FileTransferProgress, ServerRecord } from '../types';

type PaneKind = 'local' | 'remote';

const localDefaultPath = 'C:\\';
const remoteDefaultPath = '/';

export function FileBrowser() {
  const fileApi = window.autoPipeline?.fileBrowser;
  const serverApi = window.autoPipeline?.servers;
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [serverId, setServerId] = useState<number | null>(null);
  const [localPath, setLocalPath] = useState(localDefaultPath);
  const [remotePath, setRemotePath] = useState(remoteDefaultPath);
  const [localEntries, setLocalEntries] = useState<FileBrowserEntry[]>([]);
  const [remoteEntries, setRemoteEntries] = useState<FileBrowserEntry[]>([]);
  const [selectedLocal, setSelectedLocal] = useState<FileBrowserEntry | null>(null);
  const [selectedRemote, setSelectedRemote] = useState<FileBrowserEntry | null>(null);
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState<(FileTransferProgress & { direction: 'upload' | 'download' }) | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);

  useEffect(() => {
    if (!serverApi) {
      return;
    }
    void serverApi.list().then((records) => {
      setServers(records);
      setServerId((current) => current ?? records[0]?.id ?? null);
      if (records[0]?.defaultDirectory) {
        setRemotePath(records[0].defaultDirectory);
      }
    });
  }, [serverApi]);

  useEffect(() => {
    if (!fileApi) {
      return;
    }
    return fileApi.onTransferProgress((next) => setProgress(next));
  }, [fileApi]);

  useEffect(() => {
    void refreshLocal();
  }, []);

  useEffect(() => {
    if (serverId !== null) {
      void refreshRemote();
    }
  }, [serverId]);

  const selectedServer = useMemo(() => servers.find((server) => server.id === serverId) ?? null, [serverId, servers]);

  async function run(action: () => Promise<void>) {
    try {
      setMessage('');
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Operation failed');
    }
  }

  async function refreshLocal(path = localPath) {
    if (!fileApi) {
      setMessage('IPC bridge unavailable');
      return;
    }
    await run(async () => {
      const entries = await fileApi.listLocal(path);
      setLocalEntries(entries);
      setSelectedLocal(null);
      setLocalPath(path);
    });
  }

  async function refreshRemote(path = remotePath) {
    if (!fileApi || serverId === null) {
      return;
    }
    await run(async () => {
      const entries = await fileApi.listRemote(serverId, path);
      setRemoteEntries(entries);
      setSelectedRemote(null);
      setRemotePath(path);
    });
  }

  async function createDirectory(kind: PaneKind) {
    const name = window.prompt('Directory name');
    if (!name) {
      return;
    }
    await run(async () => {
      if (kind === 'local') {
        await fileApi?.createLocalDirectory(localPath, name);
        await refreshLocal();
      } else if (serverId !== null) {
        await fileApi?.createRemoteDirectory(serverId, remotePath, name);
        await refreshRemote();
      }
    });
  }

  async function renameSelected(kind: PaneKind) {
    const selected = kind === 'local' ? selectedLocal : selectedRemote;
    if (!selected) {
      setMessage('Select an entry first');
      return;
    }
    const name = window.prompt('New name', selected.name);
    if (!name) {
      return;
    }
    await run(async () => {
      if (kind === 'local') {
        await fileApi?.renameLocal(selected.path, name);
        await refreshLocal();
      } else if (serverId !== null) {
        await fileApi?.renameRemote(serverId, selected.path, name);
        await refreshRemote();
      }
    });
  }

  async function deleteSelected(kind: PaneKind) {
    const selected = kind === 'local' ? selectedLocal : selectedRemote;
    if (!selected) {
      setMessage('Select an entry first');
      return;
    }
    if (!window.confirm(`Delete ${selected.name}?`)) {
      return;
    }
    await run(async () => {
      if (kind === 'local') {
        await fileApi?.deleteLocal(selected.path);
        await refreshLocal();
      } else if (serverId !== null) {
        await fileApi?.deleteRemote(serverId, selected.path);
        await refreshRemote();
      }
    });
  }

  async function uploadSelected() {
    if (!selectedLocal || selectedLocal.type !== 'file' || serverId === null) {
      setMessage('Select a local file and a remote server first');
      return;
    }
    await run(async () => {
      setTransferBusy(true);
      setProgress({ direction: 'upload', transferredBytes: 0, totalBytes: selectedLocal.size, percent: 0 });
      try {
        await fileApi?.upload(serverId, selectedLocal.path, remotePath);
        await refreshRemote();
        setMessage(`Uploaded ${selectedLocal.name}`);
      } finally {
        setTransferBusy(false);
      }
    });
  }

  async function downloadSelected() {
    if (!selectedRemote || selectedRemote.type !== 'file' || serverId === null) {
      setMessage('Select a remote file and a local destination first');
      return;
    }
    await run(async () => {
      setTransferBusy(true);
      setProgress({ direction: 'download', transferredBytes: 0, totalBytes: selectedRemote.size, percent: 0 });
      try {
        await fileApi?.download(serverId, selectedRemote.path, localPath);
        await refreshLocal();
        setMessage(`Downloaded ${selectedRemote.name}`);
      } finally {
        setTransferBusy(false);
      }
    });
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid min-h-[520px] flex-1 grid-cols-1 gap-4 xl:grid-cols-2">
        <BrowserPane
          entries={localEntries}
          kind="local"
          onCreateDirectory={() => void createDirectory('local')}
          onDelete={() => void deleteSelected('local')}
          onNavigate={(path) => void refreshLocal(path)}
          onPathChange={setLocalPath}
          onRefresh={() => void refreshLocal()}
          onRename={() => void renameSelected('local')}
          path={localPath}
          selected={selectedLocal}
          setSelected={setSelectedLocal}
          title="Local"
        />
        <BrowserPane
          entries={remoteEntries}
          kind="remote"
          onCreateDirectory={() => void createDirectory('remote')}
          onDelete={() => void deleteSelected('remote')}
          onNavigate={(path) => void refreshRemote(path)}
          onPathChange={setRemotePath}
          onRefresh={() => void refreshRemote()}
          onRename={() => void renameSelected('remote')}
          path={remotePath}
          selected={selectedRemote}
          setSelected={setSelectedRemote}
          title="Remote"
        >
          <label className="grid gap-1 text-xs text-slate-400" htmlFor="file-browser-server">
            Server
            <select
              className="h-9 rounded-md border border-border bg-slate-950 px-3 text-sm text-white outline-none focus:border-accent"
              id="file-browser-server"
              onChange={(event) => {
                const nextId = Number(event.target.value);
                const nextServer = servers.find((server) => server.id === nextId);
                setServerId(nextId);
                setRemotePath(nextServer?.defaultDirectory || remoteDefaultPath);
              }}
              value={serverId ?? ''}
            >
              {servers.length === 0 ? <option value="">No servers</option> : null}
              {servers.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.displayName}
                </option>
              ))}
            </select>
          </label>
          <p className="truncate text-xs text-slate-500">{selectedServer ? `${selectedServer.username}@${selectedServer.host}` : 'No remote connection selected'}</p>
        </BrowserPane>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button disabled={transferBusy || !selectedLocal || selectedLocal.type !== 'file' || serverId === null} onClick={() => void uploadSelected()} type="button">
          <Upload aria-hidden="true" size={16} />
          Upload
        </Button>
        <Button disabled={transferBusy || !selectedRemote || selectedRemote.type !== 'file' || serverId === null} onClick={() => void downloadSelected()} type="button" variant="ghost">
          <Download aria-hidden="true" size={16} />
          Download
        </Button>
        <div className="min-w-[240px] flex-1">
          <div className="h-2 overflow-hidden rounded bg-slate-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress?.percent ?? 0}>
            <div className="h-full bg-accent transition-[width]" style={{ width: `${progress?.percent ?? 0}%` }} />
          </div>
          <p className="mt-1 min-h-5 text-xs text-slate-400">
            {progress ? `${progress.direction} ${progress.percent}% (${formatBytes(progress.transferredBytes)} / ${formatBytes(progress.totalBytes)})` : 'Idle'}
          </p>
        </div>
        <p aria-live="polite" className="min-h-5 min-w-[220px] text-sm text-slate-300">
          {message}
        </p>
      </div>
    </section>
  );
}

interface BrowserPaneProps {
  children?: ReactNode;
  entries: FileBrowserEntry[];
  kind: PaneKind;
  onCreateDirectory: () => void;
  onDelete: () => void;
  onNavigate: (path: string) => void;
  onPathChange: (path: string) => void;
  onRefresh: () => void;
  onRename: () => void;
  path: string;
  selected: FileBrowserEntry | null;
  setSelected: (entry: FileBrowserEntry | null) => void;
  title: string;
}

function BrowserPane({ children, entries, kind, onCreateDirectory, onDelete, onNavigate, onPathChange, onRefresh, onRename, path, selected, setSelected, title }: BrowserPaneProps) {
  return (
    <section aria-label={`${title} file pane`} className="flex min-h-0 flex-col rounded-md border border-border bg-slate-900">
      <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
        <div className="min-w-[220px] flex-1">
          <label className="grid gap-1 text-xs text-slate-400" htmlFor={`file-browser-${kind}-path`}>
            {title} path
            <input
              className="h-9 rounded-md border border-border bg-slate-950 px-3 text-sm text-white outline-none focus:border-accent"
              id={`file-browser-${kind}-path`}
              onChange={(event) => onPathChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  onNavigate(path);
                }
              }}
              value={path}
            />
          </label>
        </div>
        {children}
        <IconButton label={`Open parent ${title}`} onClick={() => onNavigate(parentPath(path, kind))}>
          <CornerUpLeft aria-hidden="true" size={16} />
        </IconButton>
        <IconButton label={`Refresh ${title}`} onClick={onRefresh}>
          <RefreshCw aria-hidden="true" size={16} />
        </IconButton>
        <IconButton label={`Create ${title} directory`} onClick={onCreateDirectory}>
          <FolderPlus aria-hidden="true" size={16} />
        </IconButton>
        <IconButton disabled={!selected} label={`Rename ${title} entry`} onClick={onRename}>
          <Pencil aria-hidden="true" size={16} />
        </IconButton>
        <IconButton disabled={!selected} label={`Delete ${title} entry`} onClick={onDelete}>
          <Trash2 aria-hidden="true" size={16} />
        </IconButton>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_96px_152px] border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-normal text-slate-500">
        <span>Name</span>
        <span>Size</span>
        <span>Modified</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto" role="listbox" aria-label={`${title} entries`}>
        {entries.map((entry) => (
          <button
            aria-selected={selected?.path === entry.path}
            className={`grid w-full grid-cols-[minmax(0,1fr)_96px_152px] items-center gap-2 px-4 py-2 text-left text-sm hover:bg-slate-800 focus:bg-slate-800 focus:outline-none ${
              selected?.path === entry.path ? 'bg-slate-800 text-white' : 'text-slate-300'
            }`}
            key={entry.path}
            onClick={() => setSelected(entry)}
            onDoubleClick={() => entry.type === 'directory' ? onNavigate(entry.path) : undefined}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && entry.type === 'directory') {
                event.preventDefault();
                onNavigate(entry.path);
              }
            }}
            role="option"
            type="button"
          >
            <span className="truncate">{entry.type === 'directory' ? '[dir] ' : ''}{entry.name}</span>
            <span className="text-xs text-slate-400">{entry.type === 'directory' ? '-' : formatBytes(entry.size)}</span>
            <span className="text-xs text-slate-400">{formatDate(entry.modifiedAt)}</span>
          </button>
        ))}
        {entries.length === 0 ? <p className="p-4 text-sm text-slate-500">No entries</p> : null}
      </div>
    </section>
  );
}

function IconButton({ children, disabled, label, onClick }: { children: ReactNode; disabled?: boolean; label: string; onClick: () => void }) {
  return (
    <Button aria-label={label} disabled={disabled} onClick={onClick} size="icon" title={label} type="button" variant="ghost">
      {children}
    </Button>
  );
}

function parentPath(path: string, kind: PaneKind) {
  const normalized = kind === 'remote' ? path.replace(/\\/g, '/') : path;
  if (kind === 'remote') {
    const trimmed = normalized.replace(/\/+$/, '');
    const parent = trimmed.slice(0, Math.max(trimmed.lastIndexOf('/'), 1));
    return parent || '/';
  }
  const stripped = normalized.replace(/[\\/]+$/, '');
  const index = Math.max(stripped.lastIndexOf('\\'), stripped.lastIndexOf('/'));
  return index > 0 ? stripped.slice(0, index) : stripped;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}
