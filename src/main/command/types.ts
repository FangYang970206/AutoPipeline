export type CommandType = 'shell' | 'transfer';

export type ShellFailureMode = 'stop' | 'continue' | 'skip_unit';

export interface ShellCommandConfig {
  name: string;
  script: string;
  serverId: number | null;
  shellType: 'powershell' | 'cmd';
  timeout?: number;
  onFailure: ShellFailureMode;
}

export interface TransferCommandConfig {
  name: string;
  direction: 'upload' | 'download';
  source: string;
  destination: string;
  overwriteMode: 'overwrite' | 'skip' | 'error';
  serverId: number | null;
}

export type CommandConfig = ShellCommandConfig | TransferCommandConfig;

export interface ShellCommandRecord {
  id: string;
  unitId: string;
  order: number;
  type: 'shell';
  config: ShellCommandConfig;
}

export interface TransferCommandRecord {
  id: string;
  unitId: string;
  order: number;
  type: 'transfer';
  config: TransferCommandConfig;
}

export type CommandRecord = ShellCommandRecord | TransferCommandRecord;
export type CommandInput = Omit<ShellCommandRecord, 'unitId'> | Omit<TransferCommandRecord, 'unitId'>;
