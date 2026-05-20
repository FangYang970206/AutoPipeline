import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { beforeEach, describe, expect, it } from 'vitest';
import { FileBrowserService, type FileBrowserSftp } from './fileBrowserService.js';
import type { ServerRepository } from '../server/serverRepository.js';
import type { ServerRecord } from '../server/types.js';
import type { SshConnectionPool } from '../execution/sshConnectionPool.js';

const server: ServerRecord = {
  id: 1,
  displayName: 'Production',
  host: 'prod.example.com',
  port: 22,
  username: 'deploy',
  authMethod: 'password',
  keyPath: null,
  connectionTimeout: 30,
  keepaliveInterval: 15,
  defaultDirectory: '/var/www',
  notes: '',
  createdAt: '2026-05-18T00:00:00Z',
  updatedAt: '2026-05-18T00:00:00Z',
};

describe('FileBrowserService', () => {
  let root: string;
  let sftp: FakeSftp;
  let service: FileBrowserService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'autopipeline-file-browser-'));
    sftp = new FakeSftp();
    service = new FileBrowserService(
      { get: () => server } as unknown as ServerRepository,
      { acquire: async () => ({ client: { sftp: (callback: (error: Error | undefined, sftp: FileBrowserSftp) => void) => callback(undefined, sftp) }, key: 'prod' }) } as unknown as SshConnectionPool,
    );
  });

  it('lists local directory entries with type, size, and modified date', async () => {
    await mkdir(join(root, 'logs'));
    await writeFile(join(root, 'deploy.log'), 'ready');

    const entries = await service.listLocalDirectory(root);

    expect(entries).toEqual([
      expect.objectContaining({ name: 'logs', type: 'directory', size: 0 }),
      expect.objectContaining({ name: 'deploy.log', type: 'file', size: 5 }),
    ]);
    expect(entries[0].modifiedAt).toMatch(/T/);
  });

  it('creates, renames, and deletes local entries', async () => {
    await service.createLocalDirectory(root, 'releases');
    await service.renameLocal(join(root, 'releases'), 'archive');
    await service.deleteLocal(join(root, 'archive'));

    await expect(stat(join(root, 'archive'))).rejects.toThrow();
  });

  it('lists and mutates remote entries through the shared SSH pool', async () => {
    sftp.seedDirectory('/var/www', [
      { filename: 'app', attrs: stats(true, 0, 1000) },
      { filename: 'index.html', attrs: stats(false, 11, 2000) },
    ]);

    const entries = await service.listRemoteDirectory(1, '/var/www');
    await service.createRemoteDirectory(1, '/var/www', 'releases');
    sftp.seedDirectory('/var/www/releases', [
      { filename: 'nested', attrs: stats(true, 0, 3000) },
    ]);
    sftp.seedDirectory('/var/www/releases/nested', [
      { filename: 'old.log', attrs: stats(false, 4, 4000) },
    ]);
    await service.renameRemote(1, '/var/www/releases', 'archive');
    await service.deleteRemote(1, '/var/www/archive');

    expect(entries).toEqual([
      expect.objectContaining({ name: 'app', path: '/var/www/app', type: 'directory', size: 0 }),
      expect.objectContaining({ name: 'index.html', path: '/var/www/index.html', type: 'file', size: 11 }),
    ]);
    expect(sftp.operations).toContain('mkdir:/var/www/releases');
    expect(sftp.operations).toContain('rename:/var/www/releases:/var/www/archive');
    expect(sftp.operations).toContain('unlink:/var/www/archive/nested/old.log');
    expect(sftp.operations).toContain('rmdir:/var/www/archive/nested');
    expect(sftp.operations).toContain('rmdir:/var/www/archive');
  });

  it('maps ssh2 remote mtime seconds into ISO dates', async () => {
    sftp.seedDirectory('/var/www', [
      { filename: 'index.html', attrs: { isDirectory: () => false, size: 11, mtime: 1_715_731_200 } },
    ]);

    const entries = await service.listRemoteDirectory(1, '/var/www');

    expect(entries[0].modifiedAt).toBe('2024-05-15T00:00:00.000Z');
  });

  it('unlinks remote directory symlinks without recursing into the target', async () => {
    sftp.seedDirectory('/var/www', [
      { filename: 'current', attrs: { isDirectory: () => true, isSymbolicLink: () => true, size: 0 } },
    ]);
    sftp.seedDirectory('/var/www/current', [
      { filename: 'keep.log', attrs: stats(false, 4, 4000) },
    ]);

    await service.deleteRemote(1, '/var/www/current');

    expect(sftp.operations).toContain('unlink:/var/www/current');
    expect(sftp.operations).not.toContain('unlink:/var/www/current/keep.log');
  });

  it('uploads and downloads files with progress updates', async () => {
    const localFile = join(root, 'bundle.zip');
    await writeFile(localFile, 'artifact');
    sftp.seedFile('/var/www/app.log', 9);
    const progress: number[] = [];

    await service.upload(1, localFile, '/var/www', (event) => progress.push(event.percent));
    await service.download(1, '/var/www/app.log', root, (event) => progress.push(event.percent));

    expect(sftp.operations).toContain(`fastPut:${localFile}:/var/www/bundle.zip`);
    expect(sftp.operations).toContain(`fastGet:/var/www/app.log:${join(root, 'app.log')}`);
    expect(progress).toContain(100);
    await expect(readFile(join(root, 'app.log'), 'utf8')).resolves.toBe('downloaded');
  });
});

interface FakeStats {
  isDirectory: () => boolean;
  isSymbolicLink?: () => boolean;
  size: number;
  mtime?: Date | number;
  mtimeMs?: number;
}

function stats(isDirectory: boolean, size: number, mtimeMs = Date.now()): FakeStats {
  return {
    isDirectory: () => isDirectory,
    size,
    mtime: new Date(mtimeMs),
    mtimeMs,
  };
}

class FakeSftp implements FileBrowserSftp {
  readonly operations: string[] = [];
  private readonly directories = new Map<string, Array<{ filename: string; attrs: FakeStats }>>();
  private readonly directoryAttrs = new Map<string, FakeStats>();
  private readonly files = new Map<string, FakeStats>();

  seedDirectory(path: string, entries: Array<{ filename: string; attrs: FakeStats }>) {
    this.directories.set(path, entries);
    this.directoryAttrs.set(path, this.directoryAttrs.get(path) ?? stats(true, 0));
    for (const entry of entries) {
      const entryPath = `${path.replace(/\/+$/, '')}/${entry.filename}`;
      if (entry.attrs.isDirectory()) {
        this.directories.set(entryPath, []);
        this.directoryAttrs.set(entryPath, entry.attrs);
      } else {
        this.files.set(entryPath, entry.attrs);
      }
    }
  }

  seedFile(path: string, size: number) {
    this.files.set(path, stats(false, size));
  }

  readdir(path: string, callback: (error: Error | undefined, entries?: Array<{ filename: string; attrs: FakeStats }>) => void): void {
    callback(undefined, this.directories.get(path) ?? []);
  }

  stat(path: string, callback: (error: Error | undefined, attrs?: FakeStats) => void): void {
    const directoryAttrs = this.directoryAttrs.get(path);
    callback(undefined, directoryAttrs && !directoryAttrs.isSymbolicLink?.() ? stats(true, 0) : this.files.get(path) ?? directoryAttrs);
  }

  lstat(path: string, callback: (error: Error | undefined, attrs?: FakeStats) => void): void {
    callback(undefined, this.directoryAttrs.get(path) ?? this.files.get(path));
  }

  mkdir(path: string, callback: (error?: Error) => void): void {
    this.operations.push(`mkdir:${path}`);
    this.directories.set(path, []);
    this.directoryAttrs.set(path, stats(true, 0));
    callback();
  }

  rmdir(path: string, callback: (error?: Error) => void): void {
    this.operations.push(`rmdir:${path}`);
    this.directories.delete(path);
    this.directoryAttrs.delete(path);
    callback();
  }

  unlink(path: string, callback: (error?: Error) => void): void {
    this.operations.push(`unlink:${path}`);
    this.files.delete(path);
    callback();
  }

  rename(oldPath: string, newPath: string, callback: (error?: Error) => void): void {
    this.operations.push(`rename:${oldPath}:${newPath}`);
    const directory = this.directories.get(oldPath);
    if (directory) {
      const attrs = this.directoryAttrs.get(oldPath) ?? stats(true, 0);
      this.directories.delete(oldPath);
      this.directoryAttrs.delete(oldPath);
      this.directories.set(newPath, directory);
      this.directoryAttrs.set(newPath, attrs);
      for (const [path, entries] of Array.from(this.directories.entries())) {
        if (path.startsWith(`${oldPath}/`)) {
          const nestedAttrs = this.directoryAttrs.get(path) ?? stats(true, 0);
          this.directories.delete(path);
          this.directoryAttrs.delete(path);
          this.directories.set(path.replace(oldPath, newPath), entries);
          this.directoryAttrs.set(path.replace(oldPath, newPath), nestedAttrs);
        }
      }
    }
    const file = this.files.get(oldPath);
    if (file) {
      this.files.delete(oldPath);
      this.files.set(newPath, file);
    }
    for (const [path, attrs] of Array.from(this.files.entries())) {
      if (path.startsWith(`${oldPath}/`)) {
        this.files.delete(path);
        this.files.set(path.replace(oldPath, newPath), attrs);
      }
    }
    callback();
  }

  fastPut(localPath: string, remotePath: string, options: { step?: (transferred: number, chunk: number, total: number) => void }, callback: (error?: Error) => void): void {
    this.operations.push(`fastPut:${localPath}:${remotePath}`);
    options.step?.(8, 8, 8);
    callback();
  }

  fastGet(remotePath: string, localPath: string, options: { step?: (transferred: number, chunk: number, total: number) => void }, callback: (error?: Error) => void): void {
    this.operations.push(`fastGet:${remotePath}:${localPath}`);
    options.step?.(9, 9, 9);
    void writeFile(localPath, 'downloaded').then(() => callback());
  }
}
