import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, FolderKanban, HardDrive, Server, Settings, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './components/ui/button';
import { useAppStore } from './store/appStore';
import type { AppSettings, RunCompletionNotification, ViewId } from './types';
import { PipelineManagement } from './views/PipelineManagement';
import { ServerManagement } from './views/ServerManagement';

const navItems: Array<{
  id: ViewId;
  icon: typeof FolderKanban;
}> = [
  { id: 'pipelines', icon: FolderKanban },
  { id: 'fileBrowser', icon: HardDrive },
  { id: 'servers', icon: Server },
  { id: 'settings', icon: Settings },
];

export function App() {
  const { i18n, t } = useTranslation();
  const activeView = useAppStore((state) => state.activeView);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const [notification, setNotification] = useState<RunCompletionNotification | null>(null);

  useEffect(() => {
    const notifications = window.autoPipeline?.notifications;
    if (!notifications) {
      return;
    }
    return notifications.onRunCompleted((next) => setNotification(next));
  }, []);

  const switchLanguage = () => {
    void i18n.changeLanguage(i18n.language === 'zh-CN' ? 'en' : 'zh-CN');
  };

  return (
    <div className="flex h-screen min-h-[520px] bg-background text-foreground">
      <aside className="flex w-14 flex-col items-center border-r border-border bg-slate-950">
        <div className="flex h-14 w-full items-center justify-center border-b border-border text-sm font-semibold text-accent">
          AP
        </div>
        <nav aria-label="Primary" className="flex w-full flex-1 flex-col">
          {navItems.map((item) => {
            const Icon = item.icon;
            const selected = item.id === activeView;

            return (
              <Button
                aria-label={t(`views.${item.id}`)}
                aria-pressed={selected}
                className={selected ? 'border-l-2 border-accent bg-slate-800 text-white' : undefined}
                key={item.id}
                onClick={() => setActiveView(item.id)}
                title={t(`views.${item.id}`)}
                type="button"
                variant="sidebar"
              >
                <Icon aria-hidden="true" size={20} />
              </Button>
            );
          })}
        </nav>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border bg-slate-900 px-5">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <RunStatusIcon status={notification?.status ?? null} />
              <h1 className="truncate text-lg font-semibold">{t(`views.${activeView}`)}</h1>
            </div>
            <p className="truncate text-xs text-slate-400">{t('shell.subtitle')}</p>
          </div>
          <Button onClick={switchLanguage} type="button" variant="ghost">
            {t('actions.language')}
          </Button>
        </header>

        <section className="flex flex-1 flex-col gap-4 overflow-auto p-6">
          {notification ? (
            <div className="flex items-center justify-between rounded-md border border-accent bg-slate-900 px-4 py-3 text-sm text-white">
              <span>{notification.pipelineName} {notification.status}</span>
              <Button onClick={() => setNotification(null)} type="button" variant="ghost">
                Dismiss
              </Button>
            </div>
          ) : null}
          {activeView === 'pipelines' ? (
            <PipelineManagement />
          ) : activeView === 'servers' ? (
            <ServerManagement />
          ) : activeView === 'settings' ? (
            <SettingsPanel />
          ) : (
            <>
              <div className="max-w-3xl">
                <h2 className="text-2xl font-semibold">{t(`views.${activeView}`)}</h2>
                <p className="mt-2 text-sm text-slate-300">{t(`descriptions.${activeView}`)}</p>
              </div>
              <div className="grid max-w-3xl grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-md border border-border bg-slate-900 p-4">
                  <p className="text-sm text-slate-300">{t(`descriptions.${activeView}`)}</p>
                </div>
                <div className="rounded-md border border-border bg-slate-900 p-4">
                  <p className="text-sm text-slate-300">IPC: {window.autoPipeline ? 'ready' : 'renderer'}</p>
                </div>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function RunStatusIcon({ status }: { status: RunCompletionNotification['status'] | null }) {
  if (status === 'succeeded') {
    return <CheckCircle2 aria-label="Last run succeeded" className="text-emerald-400" size={18} />;
  }
  if (status === 'failed' || status === 'cancelled') {
    return <XCircle aria-label={`Last run ${status}`} className="text-rose-400" size={18} />;
  }
  return <Circle aria-label="No completed runs" className="text-slate-500" size={18} />;
}

const defaultSettings: AppSettings = {
  connectionPool: { idleTimeoutMinutes: 5, maxConnections: 10 },
  notifications: { inApp: true, toast: false },
  retention: { maxDays: 30, maxCount: 100 },
  language: 'zh-CN',
};

export function SettingsPanel() {
  const api = window.autoPipeline?.settings;
  const { i18n } = useTranslation();
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!api) {
      return;
    }
    void api.get().then((saved) => {
      setSettings(saved);
      void i18n.changeLanguage(saved.language);
    });
  }, [api, i18n]);

  async function save() {
    if (!api) {
      setMessage('IPC bridge unavailable');
      return;
    }
    const saved = await api.update(settings);
    setSettings(saved);
    void i18n.changeLanguage(saved.language);
    setMessage('Settings saved');
  }

  return (
    <section className="max-w-4xl">
      <h2 className="text-2xl font-semibold">Settings</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className="rounded-md border border-border bg-slate-900 p-4">
          <h3 className="text-sm font-semibold text-white">Connection pool</h3>
          <div className="mt-3 grid gap-3">
            <label className="grid gap-1 text-sm text-slate-300" htmlFor="settings-idle-timeout">
              Idle timeout minutes
              <input
                id="settings-idle-timeout"
                className="accent-accent"
                min={1}
                max={60}
                type="range"
                value={settings.connectionPool.idleTimeoutMinutes}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    connectionPool: { ...current.connectionPool, idleTimeoutMinutes: Number(event.target.value) },
                  }))
                }
              />
              <span className="text-xs text-slate-400">{settings.connectionPool.idleTimeoutMinutes} min</span>
            </label>
            <label className="grid gap-1 text-sm text-slate-300" htmlFor="settings-max-connections">
              Max connections
              <input
                id="settings-max-connections"
                className="h-9 rounded-md border border-border bg-slate-950 px-3 text-sm text-white outline-none focus:border-accent"
                min={1}
                type="number"
                value={settings.connectionPool.maxConnections}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    connectionPool: { ...current.connectionPool, maxConnections: Number(event.target.value) },
                  }))
                }
              />
            </label>
          </div>
        </section>

        <section className="rounded-md border border-border bg-slate-900 p-4">
          <h3 className="text-sm font-semibold text-white">Notifications</h3>
          <div className="mt-3 grid gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-300" htmlFor="settings-in-app-notifications">
              <input
                id="settings-in-app-notifications"
                checked={settings.notifications.inApp}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    notifications: { ...current.notifications, inApp: event.target.checked },
                  }))
                }
                type="checkbox"
              />
              In-app notifications
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300" htmlFor="settings-toast-notifications">
              <input
                id="settings-toast-notifications"
                checked={settings.notifications.toast}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    notifications: { ...current.notifications, toast: event.target.checked },
                  }))
                }
                type="checkbox"
              />
              Windows toast
            </label>
          </div>
        </section>

        <section className="rounded-md border border-border bg-slate-900 p-4">
          <h3 className="text-sm font-semibold text-white">Run retention</h3>
          <div className="mt-3 grid gap-3">
          <label className="grid gap-1 text-sm text-slate-300" htmlFor="settings-retention-days">
            Max days
            <input
              id="settings-retention-days"
              className="h-9 rounded-md border border-border bg-slate-950 px-3 text-sm text-white outline-none focus:border-accent"
              min={1}
              type="number"
              value={settings.retention.maxDays}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  retention: { ...current.retention, maxDays: Number(event.target.value) },
                }))
              }
            />
          </label>
          <label className="grid gap-1 text-sm text-slate-300" htmlFor="settings-retention-count">
            Max count
            <input
              id="settings-retention-count"
              className="h-9 rounded-md border border-border bg-slate-950 px-3 text-sm text-white outline-none focus:border-accent"
              min={1}
              type="number"
              value={settings.retention.maxCount}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  retention: { ...current.retention, maxCount: Number(event.target.value) },
                }))
              }
            />
          </label>
        </div>
        </section>

        <section className="rounded-md border border-border bg-slate-900 p-4">
          <h3 className="text-sm font-semibold text-white">Language</h3>
          <label className="mt-3 grid gap-1 text-sm text-slate-300" htmlFor="settings-language">
            Language
            <select
              id="settings-language"
              className="h-9 rounded-md border border-border bg-slate-950 px-3 text-sm text-white outline-none focus:border-accent"
              value={settings.language}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  language: event.target.value === 'en' ? 'en' : 'zh-CN',
                }))
              }
            >
              <option value="zh-CN">中文</option>
              <option value="en">English</option>
            </select>
          </label>
        </section>
      </div>
      <div className="mt-4">
        <Button onClick={() => void save()} type="button">
          Save Settings
        </Button>
        <p aria-live="polite" className="mt-2 min-h-5 text-sm text-slate-300">{message}</p>
      </div>
    </section>
  );
}
