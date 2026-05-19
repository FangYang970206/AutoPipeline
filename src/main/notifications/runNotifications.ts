import type { AppSettings } from '../settings/appSettings.js';
import type { RunStatus } from '../execution/types.js';

export interface RunCompletionNotification {
  runId: number;
  pipelineId: number;
  pipelineName: string;
  status: Extract<RunStatus, 'succeeded' | 'failed' | 'cancelled'>;
}

export interface NotificationWindow {
  isFocused: () => boolean;
  flashFrame: (flag: boolean) => void;
  once: (event: 'focus', callback: () => void) => void;
  webContents: {
    send: (channel: string, payload: unknown) => void;
  };
}

export interface ToastNotifier {
  isSupported: () => boolean;
  show: (title: string, body: string) => void;
}

export class RunNotificationService {
  constructor(
    private readonly getSettings: () => AppSettings,
    private readonly toast: ToastNotifier,
  ) {}

  notify(window: NotificationWindow | undefined, notification: RunCompletionNotification) {
    const settings = this.getSettings();
    if (settings.notifications.inApp && window) {
      window.webContents.send('notifications:run-completed', notification);
      if (!window.isFocused()) {
        window.flashFrame(true);
        window.once('focus', () => window.flashFrame(false));
      }
    }
    if (settings.notifications.toast && this.toast.isSupported()) {
      this.toast.show(
        `Pipeline ${notification.status}`,
        `${notification.pipelineName} ${notification.status}`,
      );
    }
  }
}
