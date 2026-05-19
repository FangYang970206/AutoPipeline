import type { Database } from 'better-sqlite3';

export interface AppSettings {
  connectionPool: {
    idleTimeoutMinutes: number;
    maxConnections: number;
  };
  notifications: {
    inApp: boolean;
    toast: boolean;
  };
  retention: {
    maxDays: number;
    maxCount: number;
  };
  language: 'zh-CN' | 'en';
}

const defaultSettings: AppSettings = {
  connectionPool: {
    idleTimeoutMinutes: 5,
    maxConnections: 10,
  },
  notifications: {
    inApp: true,
    toast: false,
  },
  retention: {
    maxDays: 30,
    maxCount: 100,
  },
  language: 'zh-CN',
};

export class AppSettingsRepository {
  constructor(private readonly db: Database) {}

  getAll(): AppSettings {
    return {
      connectionPool: {
        ...defaultSettings.connectionPool,
        ...parseJsonObject(this.getValue('connectionPool')),
      },
      notifications: {
        ...defaultSettings.notifications,
        ...parseJsonObject(this.getValue('notifications')),
      },
      retention: {
        ...defaultSettings.retention,
        ...parseJsonObject(this.getValue('runRetention')),
      },
      language: this.getValue('language') === 'en' ? 'en' : 'zh-CN',
    };
  }

  updateAll(input: AppSettings): AppSettings {
    const next: AppSettings = {
      connectionPool: {
        idleTimeoutMinutes: normalizePositiveInteger(input.connectionPool.idleTimeoutMinutes, defaultSettings.connectionPool.idleTimeoutMinutes),
        maxConnections: normalizePositiveInteger(input.connectionPool.maxConnections, defaultSettings.connectionPool.maxConnections),
      },
      notifications: {
        inApp: input.notifications.inApp === true,
        toast: input.notifications.toast === true,
      },
      retention: {
        maxDays: normalizePositiveInteger(input.retention.maxDays, defaultSettings.retention.maxDays),
        maxCount: normalizePositiveInteger(input.retention.maxCount, defaultSettings.retention.maxCount),
      },
      language: input.language === 'en' ? 'en' : 'zh-CN',
    };
    this.setValue('connectionPool', JSON.stringify(next.connectionPool));
    this.setValue('notifications', JSON.stringify(next.notifications));
    this.setValue('runRetention', JSON.stringify(next.retention));
    this.setValue('language', next.language);
    return next;
  }

  private getValue(key: string) {
    return (this.db.prepare('select value from app_settings where key = ?').get(key) as { value: string } | undefined)?.value;
  }

  private setValue(key: string, value: string) {
    this.db
      .prepare(
        `insert into app_settings (key, value) values (?, ?)
         on conflict(key) do update set value = excluded.value`,
      )
      .run(key, value);
  }
}

function parseJsonObject(value: string | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizePositiveInteger(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;
}
