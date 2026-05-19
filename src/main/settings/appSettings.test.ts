import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migratePipelineSchema } from '../pipeline/schema';
import { AppSettingsRepository } from './appSettings';

function createRepository() {
  const db = new Database(':memory:');
  migratePipelineSchema(db);
  return new AppSettingsRepository(db);
}

describe('AppSettingsRepository', () => {
  it('returns default settings when nothing has been saved', () => {
    const repository = createRepository();

    expect(repository.getAll()).toEqual({
      connectionPool: { idleTimeoutMinutes: 5, maxConnections: 10 },
      notifications: { inApp: true, toast: false },
      retention: { maxDays: 30, maxCount: 100 },
      language: 'zh-CN',
    });
  });

  it('persists all settings sections and normalizes numeric inputs', () => {
    const repository = createRepository();

    const saved = repository.updateAll({
      connectionPool: { idleTimeoutMinutes: 2.8, maxConnections: 0 },
      notifications: { inApp: false, toast: true },
      retention: { maxDays: Number.NaN, maxCount: 25.9 },
      language: 'en',
    });

    expect(saved).toEqual({
      connectionPool: { idleTimeoutMinutes: 2, maxConnections: 1 },
      notifications: { inApp: false, toast: true },
      retention: { maxDays: 30, maxCount: 25 },
      language: 'en',
    });
    expect(repository.getAll()).toEqual(saved);
  });
});
