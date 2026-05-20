import { mkdir, readdir, rm, rename, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { posix } from 'node:path';
import type { SshConnectionPool } from '../execution/sshConnectionPool.js';
import type { ServerRepository } from '../server/serverRepository.js';

export type FileBrowserEntryType = 'file' | 'directory';

export interface FileBrowserEntry {
  name: string;
  path: string;
  type: FileBrowserEntryType;
  size: number;
  modifiedAt: string;
}

export interface FileTransferProgress {
  transferredBytes: number;
  totalBytes: number;
  percent: number;
}

export type FileBrowserSftp = {
  readdir(path: string, callback: (error: Error | undefined, entries?: Array<{ filename: string; attrs: RemoteStats }>) => void): void;
  lstat(path: string, callback: (error: Error | undefined, attrs?: RemoteStats) => void): void;
  stat(path: string, callback: (error: Error | undefined, attrs?: RemoteStats) => void): void;
  mkdir(path: string, callback: (error?: Error) => void): void;
  rmdir(path: string, callback: (error?: Error) => void): void;
  unlink(path: string, callback: (error?: Error) => void): void;
  rename(oldPath: string, newPath: string, callback: (error?: Error) => void): void;
  fastPut(localPath: string, remotePath: string, options: { step?: (transferred: number, chunk: number, total: number) => void }, callback: (error?: Error) => void): void;
  fastGet(remotePath: string, localPath: string, options: { step?: (transferred: number, chunk: number, total: number) => void }, callback: (error?: Error) => void): void;
  end?: () => void;
};

interface RemoteStats {
  isDirectory: () => boolean;
  isSymbolicLink?: () => boolean;
  size: number;
  mtime?: Date | number;
  mtimeMs?: number;
}

export class FileBrowserService {
  constructor(
    private readonly servers: ServerRepository,
    private readonly pool: SshConnectionPool,
  ) {}

  async listLocalDirectory(path: string): Promise<FileBrowserEntry[]> {
    const directory = resolve(path);
    const entries = await readdir(directory, { withFileTypes: true });
    const result = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = join(directory, entry.name);
        const entryStats = await stat(entryPath);
        return {
          name: entry.name,
          path: entryPath,
          type: entryStats.isDirectory() ? 'directory' as const : 'file' as const,
          size: entryStats.isDirectory() ? 0 : entryStats.size,
          modifiedAt: entryStats.mtime.toISOString(),
        };
      }),
    );
    return sortEntries(result);
  }

  async createLocalDirectory(parentPath: string, name: string): Promise<void> {
    await mkdir(join(resolve(parentPath), sanitizeName(name)), { recursive: false });
  }

  async deleteLocal(path: string): Promise<void> {
    await rm(resolve(path), { recursive: true, force: false });
  }

  async renameLocal(path: string, newName: string): Promise<void> {
    await rename(resolve(path), join(resolve(path, '..'), sanitizeName(newName)));
  }

  async listRemoteDirectory(serverId: number, path: string): Promise<FileBrowserEntry[]> {
    return this.withSftp(serverId, async (sftp) => {
      const entries = await readdirRemote(sftp, path);
      return sortEntries(entries.map((entry) => remoteEntry(path, entry)));
    });
  }

  async createRemoteDirectory(serverId: number, parentPath: string, name: string): Promise<void> {
    await this.withSftp(serverId, (sftp) => mkdirRemote(sftp, posix.join(normalizeRemote(parentPath), sanitizeName(name))));
  }

  async deleteRemote(serverId: number, path: string): Promise<void> {
    await this.withSftp(serverId, async (sftp) => {
      await deleteRemoteEntry(sftp, path);
    });
  }

  async renameRemote(serverId: number, path: string, newName: string): Promise<void> {
    await this.withSftp(serverId, (sftp) => renameRemote(sftp, path, posix.join(posix.dirname(normalizeRemote(path)), sanitizeName(newName))));
  }

  async upload(serverId: number, localPath: string, remoteDirectory: string, emit?: (progress: FileTransferProgress) => void): Promise<void> {
    const source = resolve(localPath);
    const sourceStats = await stat(source);
    if (sourceStats.isDirectory()) {
      throw new Error('Upload currently requires a file selection');
    }
    await this.withSftp(serverId, async (sftp) => {
      const remotePath = posix.join(normalizeRemote(remoteDirectory), basename(source));
      await fastPut(sftp, source, remotePath, sourceStats.size, emit);
    });
  }

  async download(serverId: number, remotePath: string, localDirectory: string, emit?: (progress: FileTransferProgress) => void): Promise<void> {
    await mkdir(resolve(localDirectory), { recursive: true });
    await this.withSftp(serverId, async (sftp) => {
      const attrs = await statRemote(sftp, remotePath);
      if (attrs.isDirectory()) {
        throw new Error('Download currently requires a file selection');
      }
      await fastGet(sftp, remotePath, join(resolve(localDirectory), posix.basename(remotePath)), attrs.size, emit);
    });
  }

  private async withSftp<T>(serverId: number, useSftp: (sftp: FileBrowserSftp) => Promise<T>): Promise<T> {
    const server = this.servers.get(serverId);
    const connection = await this.pool.acquire(server);
    const sftp = await openSftp(connection.client as unknown as { sftp(callback: (error: Error | undefined, sftp: FileBrowserSftp) => void): void });
    try {
      return await useSftp(sftp);
    } finally {
      sftp.end?.();
    }
  }
}

function sortEntries(entries: FileBrowserEntry[]) {
  return entries.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

function sanitizeName(name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error('Name must be a single file or directory name');
  }
  return trimmed;
}

function normalizeRemote(path: string) {
  return path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
}

function remoteEntry(parentPath: string, entry: { filename: string; attrs: RemoteStats }): FileBrowserEntry {
  const isDirectory = entry.attrs.isDirectory();
  return {
    name: entry.filename,
    path: posix.join(normalizeRemote(parentPath), entry.filename),
    type: isDirectory ? 'directory' : 'file',
    size: isDirectory ? 0 : entry.attrs.size,
    modifiedAt: remoteModifiedAt(entry.attrs),
  };
}

function remoteModifiedAt(attrs: RemoteStats) {
  if (attrs.mtime instanceof Date) {
    return attrs.mtime.toISOString();
  }
  const rawTimestamp = attrs.mtimeMs ?? attrs.mtime ?? Date.now();
  const timestamp = typeof rawTimestamp === 'number' && rawTimestamp > 0 && rawTimestamp < 10_000_000_000 ? rawTimestamp * 1000 : rawTimestamp;
  return new Date(timestamp).toISOString();
}

function openSftp(client: { sftp(callback: (error: Error | undefined, sftp: FileBrowserSftp) => void): void }) {
  return new Promise<FileBrowserSftp>((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(sftp);
    });
  });
}

function readdirRemote(sftp: FileBrowserSftp, path: string) {
  return new Promise<Array<{ filename: string; attrs: RemoteStats }>>((resolve, reject) => {
    sftp.readdir(normalizeRemote(path), (error, entries) => {
      if (error || !entries) {
        reject(error ?? new Error(`Remote directory not found: ${path}`));
        return;
      }
      resolve(entries.filter((entry) => entry.filename !== '.' && entry.filename !== '..'));
    });
  });
}

function statRemote(sftp: FileBrowserSftp, path: string) {
  return new Promise<RemoteStats>((resolve, reject) => {
    sftp.stat(normalizeRemote(path), (error, attrs) => {
      if (error || !attrs) {
        reject(error ?? new Error(`Remote path not found: ${path}`));
        return;
      }
      resolve(attrs);
    });
  });
}

function lstatRemote(sftp: FileBrowserSftp, path: string) {
  return new Promise<RemoteStats>((resolve, reject) => {
    sftp.lstat(normalizeRemote(path), (error, attrs) => {
      if (error || !attrs) {
        reject(error ?? new Error(`Remote path not found: ${path}`));
        return;
      }
      resolve(attrs);
    });
  });
}

function mkdirRemote(sftp: FileBrowserSftp, path: string) {
  return new Promise<void>((resolve, reject) => {
    sftp.mkdir(normalizeRemote(path), (error) => error ? reject(error) : resolve());
  });
}

function rmdirRemote(sftp: FileBrowserSftp, path: string) {
  return new Promise<void>((resolve, reject) => {
    sftp.rmdir(normalizeRemote(path), (error) => error ? reject(error) : resolve());
  });
}

async function deleteRemoteEntry(sftp: FileBrowserSftp, path: string): Promise<void> {
  const attrs = await lstatRemote(sftp, path);
  if (attrs.isSymbolicLink?.() || !attrs.isDirectory()) {
    await unlinkRemote(sftp, path);
    return;
  }
  const entries = await readdirRemote(sftp, path);
  for (const entry of entries) {
    await deleteRemoteEntry(sftp, posix.join(normalizeRemote(path), entry.filename));
  }
  await rmdirRemote(sftp, path);
}

function unlinkRemote(sftp: FileBrowserSftp, path: string) {
  return new Promise<void>((resolve, reject) => {
    sftp.unlink(normalizeRemote(path), (error) => error ? reject(error) : resolve());
  });
}

function renameRemote(sftp: FileBrowserSftp, oldPath: string, newPath: string) {
  return new Promise<void>((resolve, reject) => {
    sftp.rename(normalizeRemote(oldPath), normalizeRemote(newPath), (error) => error ? reject(error) : resolve());
  });
}

function fastPut(sftp: FileBrowserSftp, localPath: string, remotePath: string, totalBytes: number, emit?: (progress: FileTransferProgress) => void) {
  return new Promise<void>((resolve, reject) => {
    sftp.fastPut(localPath, normalizeRemote(remotePath), { step: (transferred, _chunk, total) => emitProgress(emit, transferred, total || totalBytes) }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      emitProgress(emit, totalBytes, totalBytes);
      resolve();
    });
  });
}

function fastGet(sftp: FileBrowserSftp, remotePath: string, localPath: string, totalBytes: number, emit?: (progress: FileTransferProgress) => void) {
  return new Promise<void>((resolve, reject) => {
    sftp.fastGet(normalizeRemote(remotePath), localPath, { step: (transferred, _chunk, total) => emitProgress(emit, transferred, total || totalBytes) }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      emitProgress(emit, totalBytes, totalBytes);
      resolve();
    });
  });
}

function emitProgress(emit: ((progress: FileTransferProgress) => void) | undefined, transferredBytes: number, totalBytes: number) {
  emit?.({
    transferredBytes,
    totalBytes,
    percent: totalBytes === 0 ? 100 : Math.round((transferredBytes / totalBytes) * 100),
  });
}
