import { access, mkdir, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { posix } from 'node:path';
import type { CommandRecord } from '../command/types.js';
import type { ServerRepository } from '../server/serverRepository.js';
import type { LocalCommandExecutor } from './types.js';
import type { SshConnectionPool } from './sshConnectionPool.js';

interface TransferFile {
  localPath: string;
  remotePath: string;
  size: number;
}

interface TransferSummary {
  fileCount: number;
  totalBytes: number;
  skippedCount: number;
}

interface TransferAction {
  file: TransferFile;
  skipped: boolean;
}

export interface TransferExecutionResult {
  exitCode: number;
  summary: TransferSummary;
}

type SftpLike = {
  stat(path: string, callback: (error: NodeJS.ErrnoException | undefined, stats?: { isDirectory: () => boolean; size: number }) => void): void;
  mkdir(path: string, callback: (error?: NodeJS.ErrnoException) => void): void;
  readdir(path: string, callback: (error: Error | undefined, entries?: Array<{ filename: string; attrs: { isDirectory: () => boolean; size: number } }>) => void): void;
  fastPut(localPath: string, remotePath: string, options: { step?: (transferred: number, chunk: number, total: number) => void }, callback: (error?: Error) => void): void;
  fastGet(remotePath: string, localPath: string, options: { step?: (transferred: number, chunk: number, total: number) => void }, callback: (error?: Error) => void): void;
  destroy?: () => void;
  end?: () => void;
};

export class SftpTransferExecutor implements LocalCommandExecutor {
  constructor(
    private readonly servers: ServerRepository,
    private readonly pool: SshConnectionPool,
  ) {}

  async execute(command: CommandRecord, emit: Parameters<LocalCommandExecutor['execute']>[1], options?: Parameters<LocalCommandExecutor['execute']>[2]): Promise<TransferExecutionResult> {
    if (command.type !== 'transfer') {
      throw new Error(`Unsupported transfer command type: ${command.type}`);
    }
    if (command.config.serverId === null) {
      throw new Error('Transfer command requires a server');
    }

    const server = this.servers.get(command.config.serverId);
    const connection = await this.pool.acquire(server);
    const sftp = await openSftp(connection.client as { sftp(callback: (error: Error | undefined, sftp: SftpLike) => void): void }, options?.signal);
    const abortTransfer = () => closeSftpForAbort(sftp);
    options?.signal.addEventListener('abort', abortTransfer, { once: true });
    try {
      if (options?.signal.aborted) {
        throw new Error('Transfer cancelled');
      }
      const files =
        command.config.direction === 'upload'
          ? await planUpload(command, sftp, options?.signal)
          : await planDownload(command, sftp, options?.signal);
      const actions = await planOverwriteActions(command, sftp, files, options?.signal);
      const totalBytes = actions.reduce((sum, action) => action.skipped ? sum : sum + action.file.size, 0);
      let transferredBytes = 0;
      let fileCount = 0;
      let skippedCount = actions.filter((action) => action.skipped).length;

      if (actions.length > 0 && totalBytes === 0) {
        emit({ type: 'transfer-progress', transferredBytes: 0, totalBytes: 0, percent: 100 });
      }

      for (const action of actions) {
        if (options?.signal.aborted) {
          throw new Error('Transfer cancelled');
        }
        if (action.skipped) {
          continue;
        }
        const { file } = action;

        let lastFileTransferred = 0;
        const report = (fileTransferred: number) => {
          transferredBytes += fileTransferred - lastFileTransferred;
          lastFileTransferred = fileTransferred;
          emit({
            type: 'transfer-progress',
            transferredBytes,
            totalBytes,
            percent: totalBytes === 0 ? 100 : Math.round((transferredBytes / totalBytes) * 100),
          });
        };
        if (command.config.direction === 'upload') {
          await mkdirRemote(sftp, posix.dirname(file.remotePath), options?.signal);
          await fastPut(sftp, file.localPath, file.remotePath, report, options?.signal);
        } else {
          await mkdir(dirname(file.localPath), { recursive: true });
          await fastGet(sftp, file.remotePath, file.localPath, report, options?.signal);
        }
        fileCount += 1;
      }

      return { exitCode: 0, summary: { fileCount, totalBytes: transferredBytes, skippedCount } };
    } catch (error) {
      emit({ type: 'stderr', data: error instanceof Error ? error.message : 'Transfer failed' });
      return { exitCode: 1, summary: { fileCount: 0, totalBytes: 0, skippedCount: 0 } };
    } finally {
      options?.signal.removeEventListener('abort', abortTransfer);
      sftp.end?.();
    }
  }
}

async function planOverwriteActions(command: Extract<CommandRecord, { type: 'transfer' }>, sftp: SftpLike, files: TransferFile[], signal?: AbortSignal): Promise<TransferAction[]> {
  const actions: TransferAction[] = [];
  for (const file of files) {
    const destination = command.config.direction === 'upload' ? file.remotePath : file.localPath;
    const exists = command.config.direction === 'upload' ? await remoteExists(sftp, file.remotePath, signal) : await localExists(file.localPath);
    if (exists && command.config.overwriteMode === 'error') {
      throw new Error(`Destination already exists: ${destination}`);
    }
    actions.push({ file, skipped: exists && command.config.overwriteMode === 'skip' });
  }
  return actions;
}

async function planUpload(command: Extract<CommandRecord, { type: 'transfer' }>, sftp: SftpLike, signal?: AbortSignal): Promise<TransferFile[]> {
  const localFiles = await expandLocalSource(command.config.source);
  const sourceIsDirectory = hasGlob(command.config.source) ? false : await isLocalDirectory(command.config.source);
  const destinationIsDirectory =
    await isRemoteDirectory(sftp, command.config.destination, signal).catch(() => sourceIsDirectory || hasGlob(command.config.source) || localFiles.length > 1);
  const base = localGlobBase(command.config.source);
  return localFiles.map((file) => {
    const relativePath = toPosix(relative(base, file.localPath));
    const remotePath = destinationIsDirectory
      ? posix.join(command.config.destination, relativePath || basename(file.localPath))
      : command.config.destination;
    return { ...file, remotePath };
  });
}

async function planDownload(command: Extract<CommandRecord, { type: 'transfer' }>, sftp: SftpLike, signal?: AbortSignal): Promise<TransferFile[]> {
  const files = await expandRemoteSource(sftp, command.config.source, signal);
  const destination = resolve(command.config.destination);
  const sourceIsDirectory = await isRemoteDirectory(sftp, command.config.source, signal).catch(() => false);
  const preserveRelativePaths = sourceIsDirectory || hasGlob(command.config.source);
  const sourceRoot = hasGlob(command.config.source) ? remoteGlobBase(command.config.source) : command.config.source;
  return files.map((file) => ({
    ...file,
    localPath: preserveRelativePaths
      ? join(destination, fromPosix(relativeRemote(sourceRoot, file.remotePath)))
      : destination,
  }));
}

async function expandLocalSource(source: string): Promise<Array<{ localPath: string; size: number }>> {
  if (!hasGlob(source)) {
    return listLocalFiles(resolve(source));
  }
  const base = localGlobBase(source);
  const matcher = localGlobMatcher(source);
  const files = await listLocalFiles(base);
  return files.filter((file) => matcher(file.localPath));
}

async function listLocalFiles(path: string): Promise<Array<{ localPath: string; size: number }>> {
  const stats = await stat(path);
  if (!stats.isDirectory()) {
    return [{ localPath: path, size: stats.size }];
  }
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => listLocalFiles(join(path, entry.name))),
  );
  return nested.flat();
}

async function expandRemoteSource(sftp: SftpLike, source: string, signal?: AbortSignal): Promise<Array<{ remotePath: string; size: number }>> {
  if (hasGlob(source)) {
    const base = remoteGlobBase(source);
    const matcher = remoteGlobMatcher(source);
    const files = await expandRemoteSource(sftp, base, signal);
    return files.filter((file) => matcher(file.remotePath));
  }
  const stats = await statRemote(sftp, source, signal);
  if (!stats.isDirectory()) {
    return [{ remotePath: source, size: stats.size }];
  }
  const entries = await readdirRemote(sftp, source, signal);
  const nested = await Promise.all(
    entries.map((entry) => expandRemoteSource(sftp, posix.join(source, entry.filename), signal)),
  );
  return nested.flat();
}

function hasGlob(source: string) {
  return /[*?[\]]/.test(source);
}

function localGlobBase(source: string) {
  const normalized = resolve(source);
  const parts = normalized.split(sep);
  const globIndex = parts.findIndex((part) => hasGlob(part));
  return globIndex === -1 ? normalized : parts.slice(0, globIndex).join(sep) || sep;
}

function remoteGlobBase(source: string) {
  const normalized = source.split('\\').join('/');
  const parts = normalized.split('/');
  const globIndex = parts.findIndex((part) => hasGlob(part));
  if (globIndex === -1) {
    return normalized;
  }
  const base = parts.slice(0, globIndex).join('/');
  if (base) {
    return base;
  }
  return normalized.startsWith('/') ? '/' : '.';
}

function localGlobMatcher(pattern: string) {
  const absolutePattern = toPosix(resolve(pattern));
  const regex = globRegex(absolutePattern);
  return (path: string) => regex.test(toPosix(resolve(path)));
}

function remoteGlobMatcher(pattern: string) {
  const normalizedPattern = pattern.split('\\').join('/');
  const regex = globRegex(normalizedPattern);
  return (path: string) => regex.test(path.split('\\').join('/'));
}

function globRegex(pattern: string) {
  return new RegExp(`^${pattern.split('/').map(globPartToRegex).join('/').split('.*/').join('(?:.*/)?')}$`);
}

function globPartToRegex(part: string) {
  if (part === '**') {
    return '.*';
  }
  return part
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .split('*').join('[^/]*')
    .split('?').join('[^/]');
}

function toPosix(path: string) {
  return path.split('\\').join('/');
}

function fromPosix(path: string) {
  return path.split('/').join(sep);
}

function relativeRemote(root: string, file: string) {
  return posix.relative(root.replace(/\/+$/, ''), file);
}

function openSftp(client: { sftp(callback: (error: Error | undefined, sftp: SftpLike) => void): void }, signal?: AbortSignal) {
  return new Promise<SftpLike>((resolve, reject) => {
    const cancel = () => reject(new Error('Transfer cancelled'));
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) {
      cancel();
      return;
    }
    client.sftp((error, sftp) => {
      signal?.removeEventListener('abort', cancel);
      if (error) {
        reject(error);
        return;
      }
      resolve(sftp);
    });
  });
}

function statRemote(sftp: SftpLike, path: string, signal?: AbortSignal) {
  return new Promise<{ isDirectory: () => boolean; size: number }>((resolve, reject) => {
    const cancel = createAbortHandler(sftp, reject);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) {
      cancel();
      return;
    }
    sftp.stat(path, (error, stats) => {
      signal?.removeEventListener('abort', cancel);
      if (error || !stats) {
        reject(error ?? new Error(`Remote path not found: ${path}`));
        return;
      }
      resolve(stats);
    });
  });
}

async function isRemoteDirectory(sftp: SftpLike, path: string, signal?: AbortSignal) {
  return (await statRemote(sftp, path, signal)).isDirectory();
}

async function remoteExists(sftp: SftpLike, path: string, signal?: AbortSignal) {
  return statRemote(sftp, path, signal).then(
    () => true,
    () => false,
  );
}

async function localExists(path: string) {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function isLocalDirectory(path: string) {
  return stat(resolve(path)).then(
    (stats) => stats.isDirectory(),
    () => false,
  );
}

async function mkdirRemote(sftp: SftpLike, path: string, signal?: AbortSignal) {
  const normalized = path.replace(/\/+$/, '');
  if (normalized === '' || normalized === '.') {
    return;
  }

  const segments = normalized.split('/').filter(Boolean);
  let current = normalized.startsWith('/') ? '/' : '';
  for (const segment of segments) {
    current = current === '/' ? posix.join(current, segment) : posix.join(current, segment);
    if (await remoteExists(sftp, current)) {
      continue;
    }
    await mkdirRemoteDirectory(sftp, current, signal);
  }
}

function mkdirRemoteDirectory(sftp: SftpLike, path: string, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cancel = createAbortHandler(sftp, reject);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) {
      cancel();
      return;
    }
    sftp.mkdir(path, (error) => {
      signal?.removeEventListener('abort', cancel);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function readdirRemote(sftp: SftpLike, path: string, signal?: AbortSignal) {
  return new Promise<Array<{ filename: string; attrs: { isDirectory: () => boolean; size: number } }>>((resolve, reject) => {
    const cancel = createAbortHandler(sftp, reject);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) {
      cancel();
      return;
    }
    sftp.readdir(path, (error, entries) => {
      signal?.removeEventListener('abort', cancel);
      if (error || !entries) {
        reject(error ?? new Error(`Remote directory not found: ${path}`));
        return;
      }
      resolve(entries);
    });
  });
}

function fastPut(sftp: SftpLike, localPath: string, remotePath: string, step: (transferred: number) => void, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cancel = createAbortHandler(sftp, reject);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) {
      cancel();
      return;
    }
    sftp.fastPut(localPath, remotePath, { step: (transferred) => step(transferred) }, (error) => {
      signal?.removeEventListener('abort', cancel);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function fastGet(sftp: SftpLike, remotePath: string, localPath: string, step: (transferred: number) => void, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cancel = createAbortHandler(sftp, reject);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) {
      cancel();
      return;
    }
    sftp.fastGet(remotePath, localPath, { step: (transferred) => step(transferred) }, (error) => {
      signal?.removeEventListener('abort', cancel);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function createAbortHandler(sftp: SftpLike, reject: (error: Error) => void) {
  let settled = false;
  return () => {
    if (settled) {
      return;
    }
    settled = true;
    closeSftpForAbort(sftp);
    const forceClose = setTimeout(() => {
      sftp.destroy?.();
      sftp.end?.();
    }, 3000);
    forceClose.unref();
    reject(new Error('Transfer cancelled'));
  };
}

function closeSftpForAbort(sftp: SftpLike) {
  sftp.end?.();
}
