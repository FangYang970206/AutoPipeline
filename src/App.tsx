import { FolderKanban, HardDrive, Server, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './components/ui/button';
import { useAppStore } from './store/appStore';
import type { ViewId } from './types';
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
            <h1 className="truncate text-lg font-semibold">{t(`views.${activeView}`)}</h1>
            <p className="truncate text-xs text-slate-400">{t('shell.subtitle')}</p>
          </div>
          <Button onClick={switchLanguage} type="button" variant="ghost">
            {t('actions.language')}
          </Button>
        </header>

        <section className="flex flex-1 flex-col gap-4 overflow-auto p-6">
          {activeView === 'pipelines' ? (
            <PipelineManagement />
          ) : activeView === 'servers' ? (
            <ServerManagement />
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
