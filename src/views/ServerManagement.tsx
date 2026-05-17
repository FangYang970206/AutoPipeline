import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import type { ServerAuthMethod, ServerInput, ServerRecord } from '../types';

const emptyForm: ServerInput = {
  displayName: '',
  host: '',
  port: 22,
  username: '',
  authMethod: 'password',
  password: '',
  keyPath: '',
  keyPassphrase: '',
  connectionTimeout: 30,
  keepaliveInterval: 15,
  defaultDirectory: '',
  notes: '',
};

export function ServerManagement() {
  const api = window.autoPipeline?.servers;
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [form, setForm] = useState<ServerInput>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [message, setMessage] = useState('');

  const isValid = useMemo(
    () => form.displayName.trim() && form.host.trim() && form.username.trim() && form.port > 0,
    [form.displayName, form.host, form.port, form.username],
  );

  useEffect(() => {
    void loadServers();
  }, []);

  async function loadServers() {
    if (!api) {
      return;
    }
    setServers(await api.list());
  }

  function updateField<K extends keyof ServerInput>(key: K, value: ServerInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function saveServer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || !isValid) {
      setMessage(api ? '请填写必填字段' : 'IPC bridge unavailable');
      return;
    }

    const saved = editingId === null ? await api.create(form) : await api.update(editingId, form);
    setServers((current) => {
      const withoutSaved = current.filter((server) => server.id !== saved.id);
      return [...withoutSaved, saved].sort((a, b) => a.displayName.localeCompare(b.displayName));
    });
    setEditingId(null);
    setForm(emptyForm);
    setMessage('服务器已保存');
  }

  function editServer(server: ServerRecord) {
    setEditingId(server.id);
    setForm({
      displayName: server.displayName,
      host: server.host,
      port: server.port,
      username: server.username,
      authMethod: server.authMethod,
      password: '',
      keyPath: server.keyPath ?? '',
      keyPassphrase: '',
      connectionTimeout: server.connectionTimeout,
      keepaliveInterval: server.keepaliveInterval,
      defaultDirectory: server.defaultDirectory ?? '',
      notes: server.notes,
    });
  }

  async function deleteServer(server: ServerRecord) {
    if (!api) {
      return;
    }
    try {
      await api.delete(server.id);
      setServers((current) => current.filter((item) => item.id !== server.id));
      setMessage('服务器已删除');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除失败');
    }
  }

  async function testConnection() {
    if (!api || !isValid) {
      setMessage('请先填写必填字段');
      return;
    }
    const result = await api.testConnection(form);
    setMessage(result.ok ? '连接成功' : result.message);
  }

  return (
    <div className="grid max-w-6xl grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="min-w-0">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold">服务器列表</h2>
          <span className="text-sm text-slate-400">{servers.length} configured</span>
        </div>
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-slate-900 text-slate-300">
              <tr>
                <th className="px-3 py-2 font-medium">名称</th>
                <th className="px-3 py-2 font-medium">主机</th>
                <th className="px-3 py-2 font-medium">用户</th>
                <th className="px-3 py-2 font-medium">认证</th>
                <th className="px-3 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {servers.map((server) => (
                <tr className="border-t border-border" key={server.id}>
                  <td className="px-3 py-2 font-medium">{server.displayName}</td>
                  <td className="px-3 py-2 text-slate-300">
                    {server.host}:{server.port}
                  </td>
                  <td className="px-3 py-2 text-slate-300">{server.username}</td>
                  <td className="px-3 py-2 text-slate-300">{server.authMethod}</td>
                  <td className="space-x-2 px-3 py-2 text-right">
                    <Button onClick={() => editServer(server)} type="button" variant="ghost">
                      编辑
                    </Button>
                    <Button onClick={() => void deleteServer(server)} type="button" variant="ghost">
                      删除
                    </Button>
                  </td>
                </tr>
              ))}
              {servers.length === 0 ? (
                <tr>
                  <td className="px-3 py-8 text-center text-slate-400" colSpan={5}>
                    暂无服务器
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <form className="rounded-md border border-border bg-slate-900 p-4" onSubmit={(event) => void saveServer(event)}>
        <h2 className="mb-4 text-lg font-semibold">{editingId === null ? '新增服务器' : '编辑服务器'}</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="显示名称">
            <input className={inputClass} required value={form.displayName} onChange={(event) => updateField('displayName', event.target.value)} />
          </Field>
          <Field label="主机">
            <input className={inputClass} required value={form.host} onChange={(event) => updateField('host', event.target.value)} />
          </Field>
          <Field label="端口">
            <input className={inputClass} min={1} max={65535} type="number" value={form.port} onChange={(event) => updateField('port', Number(event.target.value))} />
          </Field>
          <Field label="用户名">
            <input className={inputClass} required value={form.username} onChange={(event) => updateField('username', event.target.value)} />
          </Field>
          <Field label="认证方式">
            <select className={inputClass} value={form.authMethod} onChange={(event) => updateField('authMethod', event.target.value as ServerAuthMethod)}>
              <option value="password">密码</option>
              <option value="key">SSH Key</option>
            </select>
          </Field>
          {form.authMethod === 'password' ? (
            <Field label="密码">
              <input className={inputClass} type="password" value={form.password ?? ''} onChange={(event) => updateField('password', event.target.value)} />
            </Field>
          ) : (
            <>
              <Field label="Key 路径">
                <input className={inputClass} value={form.keyPath ?? ''} onChange={(event) => updateField('keyPath', event.target.value)} />
              </Field>
              <Field label="Key Passphrase">
                <input className={inputClass} type="password" value={form.keyPassphrase ?? ''} onChange={(event) => updateField('keyPassphrase', event.target.value)} />
              </Field>
            </>
          )}
          <Field label="连接超时">
            <input className={inputClass} min={1} type="number" value={form.connectionTimeout} onChange={(event) => updateField('connectionTimeout', Number(event.target.value))} />
          </Field>
          <Field label="Keepalive">
            <input className={inputClass} min={0} type="number" value={form.keepaliveInterval} onChange={(event) => updateField('keepaliveInterval', Number(event.target.value))} />
          </Field>
          <Field label="默认目录">
            <input className={inputClass} value={form.defaultDirectory ?? ''} onChange={(event) => updateField('defaultDirectory', event.target.value)} />
          </Field>
          <Field label="备注">
            <input className={inputClass} value={form.notes ?? ''} onChange={(event) => updateField('notes', event.target.value)} />
          </Field>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <p aria-live="polite" className="min-h-5 text-sm text-slate-300">
            {message}
          </p>
          <div className="flex gap-2">
            <Button onClick={() => void testConnection()} type="button" variant="ghost">
              测试连接
            </Button>
            <Button disabled={!isValid} type="submit">
              保存服务器
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="grid gap-1 text-sm text-slate-300">
      <span>{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  'h-9 rounded-md border border-border bg-slate-950 px-3 text-sm text-white outline-none focus:border-accent';
