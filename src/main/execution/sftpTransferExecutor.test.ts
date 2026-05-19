import { constants as fsConstants } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { Client, Server, utils as sshUtils } from 'ssh2';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandRecord } from '../command/types';
import { SftpTransferExecutor } from './sftpTransferExecutor';

let workspace: string;
let localRoot: string;
let remoteRoot: string;

const sftpStatus = {
  ok: 0,
  noSuchFile: 2,
  failure: 4,
};

type ServerSftp = {
  attrs: (requestId: number, attrs: { mode: number; uid: number; gid: number; size: number; atime: number; mtime: number }) => void;
  handle: (requestId: number, handle: Buffer) => void;
  on: (event: string, listener: (...args: never[]) => void) => ServerSftp;
  status: (requestId: number, code: number) => void;
};

beforeEach(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'autopipeline-transfer-'));
  localRoot = join(workspace, 'local');
  remoteRoot = join(workspace, 'remote');
  await mkdir(localRoot, { recursive: true });
  await mkdir(remoteRoot, { recursive: true });
});

afterEach(async () => {
  await rm(workspace, { force: true, recursive: true });
});

describe('SftpTransferExecutor', () => {
  it('uploads globbed files recursively and reports progress', async () => {
    await writeFile(join(localRoot, 'root.log'), 'root');
    await mkdir(join(localRoot, 'nested'), { recursive: true });
    await writeFile(join(localRoot, 'nested', 'app.log'), 'nested');
    await writeFile(join(localRoot, 'nested', 'ignore.txt'), 'ignore');
    const executor = createExecutor();
    const progress: Array<{ transferredBytes: number; totalBytes: number; percent: number }> = [];

    const result = await executor.execute(
      createTransferCommand({
        direction: 'upload',
        source: join(localRoot, '**', '*.log'),
        destination: '/var/logs',
      }),
      (event) => {
        if (event.type === 'transfer-progress') {
          progress.push({
            transferredBytes: event.transferredBytes,
            totalBytes: event.totalBytes,
            percent: event.percent,
          });
        }
      },
    );

    expect(result).toEqual({ exitCode: 0, summary: { fileCount: 2, totalBytes: 10, skippedCount: 0 } });
    await expect(readFile(join(remoteRoot, 'var/logs/root.log'), 'utf8')).resolves.toBe('root');
    await expect(readFile(join(remoteRoot, 'var/logs/nested/app.log'), 'utf8')).resolves.toBe('nested');
    await expect(stat(join(remoteRoot, 'var/logs/nested/ignore.txt'))).rejects.toThrow();
    expect(progress.at(-1)).toEqual({ transferredBytes: 10, totalBytes: 10, percent: 100 });
  });

  it('uploads a single file to a destination file path', async () => {
    await writeFile(join(localRoot, 'artifact.zip'), 'zip');
    const executor = createExecutor();

    const result = await executor.execute(
      createTransferCommand({
        direction: 'upload',
        source: join(localRoot, 'artifact.zip'),
        destination: '/deploy/releases/artifact.zip',
      }),
      () => {},
    );

    expect(result).toEqual({ exitCode: 0, summary: { fileCount: 1, totalBytes: 3, skippedCount: 0 } });
    await expect(readFile(join(remoteRoot, 'deploy/releases/artifact.zip'), 'utf8')).resolves.toBe('zip');
    await expect(stat(join(remoteRoot, 'deploy/releases/artifact.zip/artifact.zip'))).rejects.toThrow();
  });

  it('uploads through an in-process mock SFTP server', async () => {
    await writeFile(join(localRoot, 'bundle.tgz'), 'bundle');
    const server = await startMockSftpServer(remoteRoot);
    const client = await connectSshClient(server.port);
    const executor = new SftpTransferExecutor(
      { get: () => ({ id: 1 }) } as never,
      { acquire: async () => ({ client }) } as never,
    );

    try {
      const result = await executor.execute(
        createTransferCommand({
          direction: 'upload',
          source: join(localRoot, 'bundle.tgz'),
          destination: '/packages/bundle.tgz',
        }),
        () => {},
      );

      expect(result).toEqual({ exitCode: 0, summary: { fileCount: 1, totalBytes: 6, skippedCount: 0 } });
      await expect(readFile(join(remoteRoot, 'packages/bundle.tgz'), 'utf8')).resolves.toBe('bundle');
    } finally {
      client.end();
      await server.close();
    }
  });

  it('downloads remote glob matches recursively', async () => {
    await mkdir(join(remoteRoot, 'srv/app/config'), { recursive: true });
    await writeFile(join(remoteRoot, 'srv/app/index.log'), 'index');
    await writeFile(join(remoteRoot, 'srv/app/config/prod.log'), 'prod');
    await writeFile(join(remoteRoot, 'srv/app/config/ignore.txt'), 'ignore');
    const executor = createExecutor();

    const result = await executor.execute(
      createTransferCommand({
        direction: 'download',
        source: '/srv/app/**/*.log',
        destination: join(localRoot, 'downloaded'),
      }),
      () => {},
    );

    expect(result).toEqual({ exitCode: 0, summary: { fileCount: 2, totalBytes: 9, skippedCount: 0 } });
    await expect(readFile(join(localRoot, 'downloaded/index.log'), 'utf8')).resolves.toBe('index');
    await expect(readFile(join(localRoot, 'downloaded/config/prod.log'), 'utf8')).resolves.toBe('prod');
    await expect(stat(join(localRoot, 'downloaded/config/ignore.txt'))).rejects.toThrow();
  });

  it('honors skip and error overwrite modes', async () => {
    await writeFile(join(localRoot, 'artifact.txt'), 'new');
    await writeFile(join(localRoot, 'new.txt'), 'new');
    await mkdir(join(remoteRoot, 'deploy'), { recursive: true });
    await writeFile(join(remoteRoot, 'deploy/artifact.txt'), 'old');
    const executor = createExecutor();
    const progress: Array<{ transferredBytes: number; totalBytes: number; percent: number }> = [];

    const skipped = await executor.execute(
      createTransferCommand({
        direction: 'upload',
        source: join(localRoot, '*.txt'),
        destination: '/deploy',
        overwriteMode: 'skip',
      }),
      (event) => {
        if (event.type === 'transfer-progress') {
          progress.push({
            transferredBytes: event.transferredBytes,
            totalBytes: event.totalBytes,
            percent: event.percent,
          });
        }
      },
    );

    expect(skipped).toEqual({ exitCode: 0, summary: { fileCount: 1, totalBytes: 3, skippedCount: 1 } });
    await expect(readFile(join(remoteRoot, 'deploy/artifact.txt'), 'utf8')).resolves.toBe('old');
    await expect(readFile(join(remoteRoot, 'deploy/new.txt'), 'utf8')).resolves.toBe('new');
    expect(progress.at(-1)).toEqual({ transferredBytes: 3, totalBytes: 3, percent: 100 });
    await expect(
      executor.execute(
        createTransferCommand({
          direction: 'upload',
          source: join(localRoot, 'artifact.txt'),
          destination: '/deploy',
          overwriteMode: 'error',
        }),
        () => {},
      ),
    ).resolves.toMatchObject({ exitCode: 1 });
  });

  it('reports complete progress when every file is skipped', async () => {
    await writeFile(join(localRoot, 'artifact.txt'), 'new');
    await mkdir(join(remoteRoot, 'deploy'), { recursive: true });
    await writeFile(join(remoteRoot, 'deploy/artifact.txt'), 'old');
    const executor = createExecutor();
    const progress: Array<{ transferredBytes: number; totalBytes: number; percent: number }> = [];

    const result = await executor.execute(
      createTransferCommand({
        direction: 'upload',
        source: join(localRoot, 'artifact.txt'),
        destination: '/deploy',
        overwriteMode: 'skip',
      }),
      (event) => {
        if (event.type === 'transfer-progress') {
          progress.push({
            transferredBytes: event.transferredBytes,
            totalBytes: event.totalBytes,
            percent: event.percent,
          });
        }
      },
    );

    expect(result).toEqual({ exitCode: 0, summary: { fileCount: 0, totalBytes: 0, skippedCount: 1 } });
    expect(progress).toEqual([{ transferredBytes: 0, totalBytes: 0, percent: 100 }]);
  });

  it('settles and closes the SFTP channel when cancelled mid-transfer', async () => {
    await writeFile(join(localRoot, 'artifact.txt'), 'new');
    const controller = new AbortController();
    const sftp = new HangingSftp(remoteRoot);
    const executor = new SftpTransferExecutor(
      { get: () => ({ id: 1 }) } as never,
      { acquire: async () => ({ client: { sftp: (callback: (error: Error | undefined, channel: HangingSftp) => void) => callback(undefined, sftp) } }) } as never,
    );

    const running = executor.execute(
      createTransferCommand({
        direction: 'upload',
        source: join(localRoot, 'artifact.txt'),
        destination: '/deploy/artifact.txt',
      }),
      () => {},
      { runId: 1, signal: controller.signal },
    );
    await sftp.transferStarted;
    controller.abort();

    await expect(running).resolves.toMatchObject({ exitCode: 1 });
    expect(sftp.endCalls).toBeGreaterThan(0);
  });

  it('settles and closes the SFTP channel when cancelled during remote planning', async () => {
    const controller = new AbortController();
    const sftp = new HangingStatSftp(remoteRoot);
    const executor = new SftpTransferExecutor(
      { get: () => ({ id: 1 }) } as never,
      { acquire: async () => ({ client: { sftp: (callback: (error: Error | undefined, channel: HangingStatSftp) => void) => callback(undefined, sftp) } }) } as never,
    );

    const running = executor.execute(
      createTransferCommand({
        direction: 'download',
        source: '/srv/**/*.log',
        destination: join(localRoot, 'downloaded'),
      }),
      () => {},
      { runId: 1, signal: controller.signal },
    );
    await sftp.statStarted;
    controller.abort();

    await expect(running).resolves.toMatchObject({ exitCode: 1 });
    expect(sftp.endCalls).toBeGreaterThan(0);
  });
});

function createExecutor() {
  const sftp = new FakeSftp(remoteRoot);
  return new SftpTransferExecutor(
    { get: () => ({ id: 1 }) } as never,
    { acquire: async () => ({ client: { sftp: (callback: (error: Error | undefined, channel: FakeSftp) => void) => callback(undefined, sftp) } }) } as never,
  );
}

function createTransferCommand(config: Partial<Extract<CommandRecord, { type: 'transfer' }>['config']>): CommandRecord {
  return {
    id: 'cmd-transfer',
    unitId: 'unit-a',
    order: 0,
    type: 'transfer',
    config: {
      name: 'Transfer',
      direction: 'upload',
      source: '',
      destination: '',
      overwriteMode: 'overwrite',
      serverId: 1,
      ...config,
    },
  };
}

class FakeSftp {
  constructor(private readonly root: string) {}

  async stat(path: string, callback: (error: NodeJS.ErrnoException | undefined, stats?: { isDirectory: () => boolean; size: number }) => void) {
    try {
      const stats = await stat(this.toLocal(path));
      callback(undefined, { isDirectory: () => stats.isDirectory(), size: stats.size });
    } catch (error) {
      callback(error as NodeJS.ErrnoException);
    }
  }

  async mkdir(path: string, callback: (error?: NodeJS.ErrnoException) => void) {
    try {
      await mkdir(this.toLocal(path));
      callback();
    } catch (error) {
      callback(error as NodeJS.ErrnoException);
    }
  }

  async readdir(path: string, callback: (error: Error | undefined, entries?: Array<{ filename: string; attrs: { isDirectory: () => boolean; size: number } }>) => void) {
    try {
      const directory = this.toLocal(path);
      const names = await import('node:fs/promises').then((fs) => fs.readdir(directory));
      const entries = await Promise.all(
        names.map(async (filename) => {
          const entryStats = await stat(join(directory, filename));
          return { filename, attrs: { isDirectory: () => entryStats.isDirectory(), size: entryStats.size } };
        }),
      );
      callback(undefined, entries);
    } catch (error) {
      callback(error as Error);
    }
  }

  async fastPut(localPath: string, remotePath: string, options: { step?: (transferred: number, _chunk: number, total: number) => void }, callback: (error?: Error) => void) {
    try {
      const contents = await readFile(localPath);
      await mkdir(join(this.root, posix.dirname(normalizeRemote(remotePath))), { recursive: true });
      await writeFile(this.toLocal(remotePath), contents);
      options.step?.(contents.length, contents.length, contents.length);
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  async fastGet(remotePath: string, localPath: string, options: { step?: (transferred: number, _chunk: number, total: number) => void }, callback: (error?: Error) => void) {
    try {
      const contents = await readFile(this.toLocal(remotePath));
      await mkdir(resolve(localPath, '..'), { recursive: true });
      await writeFile(localPath, contents);
      options.step?.(contents.length, contents.length, contents.length);
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  end() {}

  private toLocal(remotePath: string) {
    return join(this.root, normalizeRemote(remotePath));
  }
}

class HangingSftp extends FakeSftp {
  endCalls = 0;
  private markStarted!: () => void;
  transferStarted = new Promise<void>((resolve) => {
    this.markStarted = resolve;
  });

  override async fastPut(
    _localPath: string,
    _remotePath: string,
    _options: { step?: (transferred: number, _chunk: number, total: number) => void },
    _callback: (error?: Error) => void,
  ) {
    this.markStarted();
  }

  override end() {
    this.endCalls += 1;
  }
}

class HangingStatSftp extends FakeSftp {
  endCalls = 0;
  private markStarted!: () => void;
  statStarted = new Promise<void>((resolve) => {
    this.markStarted = resolve;
  });

  override async stat(
    _path: string,
    _callback: (error: NodeJS.ErrnoException | undefined, stats?: { isDirectory: () => boolean; size: number }) => void,
  ) {
    this.markStarted();
  }

  override end() {
    this.endCalls += 1;
  }
}

function normalizeRemote(remotePath: string) {
  return remotePath.replace(/^\/+/, '').split('\\').join('/');
}

async function startMockSftpServer(root: string) {
  const hostKey = sshUtils.generateKeyPairSync('ed25519').private;
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on('authentication', (context) => context.accept());
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('sftp', (acceptSftp) => {
          const sftp = acceptSftp();
          const handles = new Map<number, { path: string; contents: Buffer }>();
          let handleId = 0;

          sftp.on('STAT', (requestId, path) => replyAttrs(sftp, requestId, root, path));
          sftp.on('LSTAT', (requestId, path) => replyAttrs(sftp, requestId, root, path));
          sftp.on('MKDIR', async (requestId, path) => {
            try {
              await mkdir(join(root, normalizeRemote(path)));
              sftp.status(requestId, sftpStatus.ok);
            } catch {
              sftp.status(requestId, sftpStatus.failure);
            }
          });
          sftp.on('OPEN', (requestId, path) => {
            const handle = Buffer.alloc(4);
            handle.writeUInt32BE(handleId, 0);
            handles.set(handleId, { path, contents: Buffer.alloc(0) });
            handleId += 1;
            sftp.handle(requestId, handle);
          });
          sftp.on('WRITE', (requestId, handle, offset, data) => {
            const opened = handles.get(handle.readUInt32BE(0));
            if (!opened) {
              sftp.status(requestId, sftpStatus.failure);
              return;
            }
            const position = Number(offset);
            const nextLength = Math.max(opened.contents.length, position + data.length);
            const next = Buffer.alloc(nextLength);
            opened.contents.copy(next);
            data.copy(next, position);
            opened.contents = next;
            sftp.status(requestId, sftpStatus.ok);
          });
          sftp.on('CLOSE', async (requestId, handle) => {
            const id = handle.readUInt32BE(0);
            const opened = handles.get(id);
            if (!opened) {
              sftp.status(requestId, sftpStatus.failure);
              return;
            }
            handles.delete(id);
            try {
              await writeFile(join(root, normalizeRemote(opened.path)), opened.contents);
              sftp.status(requestId, sftpStatus.ok);
            } catch {
              sftp.status(requestId, sftpStatus.failure);
            }
          });
        });
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) {
    throw new Error('Mock SFTP server did not expose a TCP port');
  }
  return {
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function connectSshClient(port: number) {
  const client = new Client();
  return new Promise<Client>((resolve, reject) => {
    client.once('ready', () => resolve(client));
    client.once('error', reject);
    client.connect({
      host: '127.0.0.1',
      port,
      username: 'test',
      password: 'test',
    });
  });
}

async function replyAttrs(
  sftp: ServerSftp,
  requestId: number,
  root: string,
  remotePath: string,
) {
  try {
    const stats = await stat(join(root, normalizeRemote(remotePath)));
    sftp.attrs(requestId, {
      mode: (stats.isDirectory() ? fsConstants.S_IFDIR : fsConstants.S_IFREG) | 0o755,
      uid: 0,
      gid: 0,
      size: stats.size,
      atime: Math.floor(stats.atimeMs / 1000),
      mtime: Math.floor(stats.mtimeMs / 1000),
    });
  } catch {
    sftp.status(requestId, sftpStatus.noSuchFile);
  }
}
