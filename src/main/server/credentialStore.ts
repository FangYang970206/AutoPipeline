export interface CredentialStore {
  setPassword(serverId: number, password: string): Promise<void>;
  getPassword(serverId: number): Promise<string | null>;
  deletePassword(serverId: number): Promise<void>;
  setKeyPassphrase(serverId: number, passphrase: string): Promise<void>;
  getKeyPassphrase(serverId: number): Promise<string | null>;
  deleteKeyPassphrase(serverId: number): Promise<void>;
}

export class InMemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>();

  async setPassword(serverId: number, password: string) {
    this.values.set(passwordKey(serverId), password);
  }

  async getPassword(serverId: number) {
    return this.values.get(passwordKey(serverId)) ?? null;
  }

  async deletePassword(serverId: number) {
    this.values.delete(passwordKey(serverId));
  }

  async setKeyPassphrase(serverId: number, passphrase: string) {
    this.values.set(passphraseKey(serverId), passphrase);
  }

  async getKeyPassphrase(serverId: number) {
    return this.values.get(passphraseKey(serverId)) ?? null;
  }

  async deleteKeyPassphrase(serverId: number) {
    this.values.delete(passphraseKey(serverId));
  }
}

export class KeytarCredentialStore implements CredentialStore {
  private readonly serviceName = 'AutoPipeline';

  async setPassword(serverId: number, password: string) {
    const keytar = await import('keytar');
    await keytar.setPassword(this.serviceName, passwordKey(serverId), password);
  }

  async getPassword(serverId: number) {
    const keytar = await import('keytar');
    return keytar.getPassword(this.serviceName, passwordKey(serverId));
  }

  async deletePassword(serverId: number) {
    const keytar = await import('keytar');
    await keytar.deletePassword(this.serviceName, passwordKey(serverId));
  }

  async setKeyPassphrase(serverId: number, passphrase: string) {
    const keytar = await import('keytar');
    await keytar.setPassword(this.serviceName, passphraseKey(serverId), passphrase);
  }

  async getKeyPassphrase(serverId: number) {
    const keytar = await import('keytar');
    return keytar.getPassword(this.serviceName, passphraseKey(serverId));
  }

  async deleteKeyPassphrase(serverId: number) {
    const keytar = await import('keytar');
    await keytar.deletePassword(this.serviceName, passphraseKey(serverId));
  }
}

function passwordKey(serverId: number) {
  return `server:${serverId}:password`;
}

function passphraseKey(serverId: number) {
  return `server:${serverId}:key-passphrase`;
}
