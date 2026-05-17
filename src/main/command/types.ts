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

export interface CommandRecord {
  id: string;
  unitId: string;
  order: number;
  type: CommandType;
  config: CommandConfig;
}

export type CommandInput = Omit<CommandRecord, 'unitId'>;
