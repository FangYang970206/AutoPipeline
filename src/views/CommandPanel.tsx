import Editor from '@monaco-editor/react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { listTemplateCompletions, parseNamedOutputs, storeOutputs } from '../main/execution/namedOutputs';
import type { OutputContext } from '../main/execution/namedOutputs';
import type {
  CommandInput,
  CommandRecord,
  ServerRecord,
  ShellCommandConfig,
  ShellCommandRecord,
  TransferCommandConfig,
  TransferCommandRecord,
} from '../types';

export function CommandPanel({ shellSessions, unitId, unitName }: { shellSessions: string[]; unitId: string; unitName: string }) {
  const commandApi = window.autoPipeline?.commands;
  const serverApi = window.autoPipeline?.servers;
  const [commands, setCommands] = useState<CommandInput[]>([]);
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [message, setMessage] = useState('');
  const templateSuggestions = useMemo(() => buildTemplateSuggestions(unitName, commands), [commands, unitName]);

  useEffect(() => {
    if (!commandApi) {
      return;
    }
    void commandApi.list(unitId).then((items) => {
      setCommands(items.map(({ unitId: _unitId, ...command }: CommandRecord) => command));
    });
    void serverApi?.list().then(setServers);
  }, [commandApi, serverApi, unitId]);

  function addShell() {
    const order = commands.length;
    setCommands((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        order,
        type: 'shell',
        config: {
          name: `Shell ${order + 1}`,
          script: '',
          serverId: null,
          shellType: 'powershell',
          onFailure: 'stop',
          sessionName: null,
          reuseSession: false,
        },
      },
    ]);
  }

  function addTransfer() {
    const order = commands.length;
    setCommands((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        order,
        type: 'transfer',
        config: {
          name: `Transfer ${order + 1}`,
          direction: 'upload',
          source: '',
          destination: '',
          overwriteMode: 'overwrite',
          serverId: null,
        },
      },
    ]);
  }

  function updateCommand(index: number, next: CommandInput) {
    setCommands((current) => current.map((command, currentIndex) => (currentIndex === index ? next : command)));
  }

  function move(index: number, delta: -1 | 1) {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= commands.length) {
      return;
    }
    const next = [...commands];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setCommands(next.map((command, order) => ({ ...command, order })));
  }

  function remove(index: number) {
    if (!window.confirm('删除 Command?')) {
      return;
    }
    setCommands((current) => current.filter((_, currentIndex) => currentIndex !== index).map((command, order) => ({ ...command, order })));
  }

  async function save() {
    if (!commandApi) {
      setMessage('IPC bridge unavailable');
      return;
    }
    await commandApi.save(unitId, commands.map((command, order) => ({ ...command, order })));
    setMessage('Command 已保存');
  }

  return (
    <aside className="w-full border-l border-border bg-slate-900 p-3 xl:w-[420px]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">{unitName}</h3>
          <p className="text-xs text-slate-400">Commands</p>
        </div>
        <Button onClick={() => void save()} type="button">
          保存 Command
        </Button>
      </div>
      <div className="mb-3 flex gap-2">
        <Button onClick={addShell} type="button" variant="ghost">
          添加 Shell
        </Button>
        <Button onClick={addTransfer} type="button" variant="ghost">
          添加 Transfer
        </Button>
      </div>
      <div className="space-y-3">
        {commands.map((command, index) => (
          <div className="rounded-md border border-border bg-slate-950 p-3" draggable key={command.id}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <strong>{command.config.name}</strong>
              <div className="flex gap-1">
                <Button disabled={index === 0} onClick={() => move(index, -1)} type="button" variant="ghost">
                  上移
                </Button>
                <Button disabled={index === commands.length - 1} onClick={() => move(index, 1)} type="button" variant="ghost">
                  下移
                </Button>
                <Button onClick={() => remove(index)} type="button" variant="ghost">
                  删除
                </Button>
              </div>
            </div>
            {command.type === 'shell' ? (
              <ShellCommandForm
                command={command as Omit<ShellCommandRecord, 'unitId'>}
                index={index}
                onChange={updateCommand}
                servers={servers}
                shellSessions={shellSessions}
                templateSuggestions={templateSuggestions}
              />
            ) : (
              <TransferCommandForm command={command as Omit<TransferCommandRecord, 'unitId'>} index={index} onChange={updateCommand} servers={servers} />
            )}
          </div>
        ))}
      </div>
      <p aria-live="polite" className="mt-3 min-h-5 text-sm text-slate-300">
        {message}
      </p>
    </aside>
  );
}

function ShellCommandForm({
  command,
  index,
  onChange,
  servers,
  shellSessions,
  templateSuggestions,
}: {
  command: Omit<ShellCommandRecord, 'unitId'>;
  index: number;
  onChange: (index: number, next: CommandInput) => void;
  servers: ServerRecord[];
  shellSessions: string[];
  templateSuggestions: string[];
}) {
  const update = (config: Partial<ShellCommandConfig>) => onChange(index, { ...command, config: { ...command.config, ...config } });
  return (
    <div className="grid gap-2 text-sm">
      <input aria-label="Command 名称" className={inputClass} value={command.config.name} onChange={(event) => update({ name: event.target.value })} />
      <select aria-label="目标服务器" className={inputClass} value={command.config.serverId ?? ''} onChange={(event) => update({ serverId: event.target.value ? Number(event.target.value) : null })}>
        <option value="">本地</option>
        {servers.map((server) => (
          <option key={server.id} value={server.id}>
            {server.displayName}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-3 gap-2">
        <select aria-label="Shell 类型" className={inputClass} value={command.config.shellType} onChange={(event) => update({ shellType: event.target.value as ShellCommandConfig['shellType'] })}>
          <option value="powershell">powershell</option>
          <option value="cmd">cmd</option>
        </select>
        <input aria-label="超时秒数" className={inputClass} type="number" value={command.config.timeout ?? ''} onChange={(event) => update({ timeout: event.target.value ? Number(event.target.value) : undefined })} />
        <select aria-label="失败策略" className={inputClass} value={command.config.onFailure} onChange={(event) => update({ onFailure: event.target.value as ShellCommandConfig['onFailure'] })}>
          <option value="stop">stop</option>
          <option value="continue">continue</option>
          <option value="skip_unit">skip_unit</option>
        </select>
      </div>
      <div className="grid grid-cols-[auto_1fr] items-center gap-2">
        <label className="flex items-center gap-2 text-slate-200">
          <input
            checked={command.config.reuseSession ?? false}
            onChange={(event) =>
              update({
                reuseSession: event.target.checked,
                sessionName: event.target.checked ? command.config.sessionName ?? shellSessions[0] ?? null : null,
              })
            }
            type="checkbox"
          />
          Reuse session
        </label>
        <select
          aria-label="Shell session"
          className={inputClass}
          disabled={!command.config.reuseSession || shellSessions.length === 0}
          value={command.config.sessionName ?? ''}
          onChange={(event) => update({ sessionName: event.target.value || null })}
        >
          <option value="">No session</option>
          {shellSessions.map((session) => (
            <option key={session} value={session}>
              {session}
            </option>
          ))}
        </select>
      </div>
      <Editor
        beforeMount={(monaco) => registerTemplateCompletions(monaco, templateSuggestions)}
        height="180px"
        language="powershell"
        theme="vs-dark"
        value={command.config.script}
        onChange={(value) => update({ script: value ?? '' })}
      />
    </div>
  );
}

function TransferCommandForm({
  command,
  index,
  onChange,
  servers,
}: {
  command: Omit<TransferCommandRecord, 'unitId'>;
  index: number;
  onChange: (index: number, next: CommandInput) => void;
  servers: ServerRecord[];
}) {
  const update = (config: Partial<TransferCommandConfig>) => onChange(index, { ...command, config: { ...command.config, ...config } });
  return (
    <div className="grid gap-2 text-sm">
      <input aria-label="Command 名称" className={inputClass} value={command.config.name} onChange={(event) => update({ name: event.target.value })} />
      <select aria-label="目标服务器" className={inputClass} value={command.config.serverId ?? ''} onChange={(event) => update({ serverId: event.target.value ? Number(event.target.value) : null })}>
        <option value="">选择服务器</option>
        {servers.map((server) => (
          <option key={server.id} value={server.id}>
            {server.displayName}
          </option>
        ))}
      </select>
      <select aria-label="传输方向" className={inputClass} value={command.config.direction} onChange={(event) => update({ direction: event.target.value as TransferCommandConfig['direction'] })}>
        <option value="upload">upload</option>
        <option value="download">download</option>
      </select>
      <input aria-label="源路径" className={inputClass} value={command.config.source} onChange={(event) => update({ source: event.target.value })} />
      <input aria-label="目标路径" className={inputClass} value={command.config.destination} onChange={(event) => update({ destination: event.target.value })} />
      <select aria-label="覆盖策略" className={inputClass} value={command.config.overwriteMode} onChange={(event) => update({ overwriteMode: event.target.value as TransferCommandConfig['overwriteMode'] })}>
        <option value="overwrite">overwrite</option>
        <option value="skip">skip</option>
        <option value="error">error</option>
      </select>
    </div>
  );
}

const inputClass =
  'h-9 rounded-md border border-border bg-slate-900 px-3 text-sm text-white outline-none focus:border-accent';

function buildTemplateSuggestions(unitName: string, commands: CommandInput[]) {
  let context: OutputContext = {};
  for (const command of commands) {
    if (command.type === 'shell') {
      context = storeOutputs(context, unitName, command.config.name, parseNamedOutputs(command.config.script));
    }
  }
  return listTemplateCompletions(context);
}

function registerTemplateCompletions(
  monaco: {
    languages: {
      CompletionItemKind: { Variable: number };
      registerCompletionItemProvider: (
        language: string,
        provider: {
          triggerCharacters: string[];
          provideCompletionItems: () => { suggestions: Array<{ label: string; kind: number; insertText: string }> };
        },
      ) => unknown;
    };
  },
  suggestions: string[],
) {
  monaco.languages.registerCompletionItemProvider('powershell', {
    triggerCharacters: ['{', '.'],
    provideCompletionItems: () => ({
      suggestions: suggestions.map((label) => ({
        label,
        kind: monaco.languages.CompletionItemKind.Variable,
        insertText: label,
      })),
    }),
  });
}
