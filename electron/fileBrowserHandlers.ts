import { ipcMain } from 'electron';
import { FileBrowserService } from '../src/main/fileBrowser/fileBrowserService.js';
import { getRuntimeServices } from './runtimeServices.js';

export function registerFileBrowserHandlers() {
  const { servers, sshPool } = getRuntimeServices();
  const browser = new FileBrowserService(servers, sshPool);

  ipcMain.handle('file-browser:local:list', (_event, path: string) => browser.listLocalDirectory(path));
  ipcMain.handle('file-browser:local:mkdir', (_event, parentPath: string, name: string) => browser.createLocalDirectory(parentPath, name));
  ipcMain.handle('file-browser:local:delete', (_event, path: string) => browser.deleteLocal(path));
  ipcMain.handle('file-browser:local:rename', (_event, path: string, newName: string) => browser.renameLocal(path, newName));
  ipcMain.handle('file-browser:remote:list', (_event, serverId: number, path: string) => browser.listRemoteDirectory(serverId, path));
  ipcMain.handle('file-browser:remote:mkdir', (_event, serverId: number, parentPath: string, name: string) => browser.createRemoteDirectory(serverId, parentPath, name));
  ipcMain.handle('file-browser:remote:delete', (_event, serverId: number, path: string) => browser.deleteRemote(serverId, path));
  ipcMain.handle('file-browser:remote:rename', (_event, serverId: number, path: string, newName: string) => browser.renameRemote(serverId, path, newName));
  ipcMain.handle('file-browser:upload', (event, serverId: number, localPath: string, remoteDirectory: string) =>
    browser.upload(serverId, localPath, remoteDirectory, (progress) => event.sender.send('file-browser:transfer-progress', { direction: 'upload', ...progress })),
  );
  ipcMain.handle('file-browser:download', (event, serverId: number, remotePath: string, localDirectory: string) =>
    browser.download(serverId, remotePath, localDirectory, (progress) => event.sender.send('file-browser:transfer-progress', { direction: 'download', ...progress })),
  );
}
