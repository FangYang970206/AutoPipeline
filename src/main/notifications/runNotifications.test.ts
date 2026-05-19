import { describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../settings/appSettings';
import { RunNotificationService } from './runNotifications';

const baseSettings: AppSettings = {
  connectionPool: { idleTimeoutMinutes: 5, maxConnections: 10 },
  notifications: { inApp: true, toast: false },
  retention: { maxDays: 30, maxCount: 100 },
  language: 'zh-CN',
};

describe('RunNotificationService', () => {
  it('sends in-app completion notifications and flashes unfocused windows', () => {
    const send = vi.fn();
    const flashFrame = vi.fn();
    let onFocus!: () => void;
    const service = new RunNotificationService(() => baseSettings, { isSupported: () => false, show: vi.fn() });

    service.notify(
      {
        isFocused: () => false,
        flashFrame,
        once: (_event, callback) => {
          onFocus = callback;
        },
        webContents: { send },
      },
      { runId: 1, pipelineId: 2, pipelineName: 'Deploy API', status: 'succeeded' },
    );

    expect(send).toHaveBeenCalledWith('notifications:run-completed', {
      runId: 1,
      pipelineId: 2,
      pipelineName: 'Deploy API',
      status: 'succeeded',
    });
    expect(flashFrame).toHaveBeenCalledWith(true);
    onFocus();
    expect(flashFrame).toHaveBeenCalledWith(false);
  });

  it('shows toast notifications only when enabled and supported', () => {
    const show = vi.fn();
    const service = new RunNotificationService(
      () => ({ ...baseSettings, notifications: { inApp: false, toast: true } }),
      { isSupported: () => true, show },
    );

    service.notify(undefined, { runId: 1, pipelineId: 2, pipelineName: 'Deploy API', status: 'failed' });

    expect(show).toHaveBeenCalledWith('Pipeline failed', 'Deploy API failed');
  });
});
