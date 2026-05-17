import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export const resources = {
  'zh-CN': {
    translation: {
      views: {
        pipelines: '流水线',
        fileBrowser: '文件浏览器',
        servers: '服务器',
        settings: '设置',
      },
      descriptions: {
        pipelines: '编排 ExecutionUnit 和 Command',
        fileBrowser: '浏览本地和远程文件',
        servers: '管理远程 SSH 连接目标',
        settings: '配置应用偏好',
      },
      actions: {
        language: 'English',
      },
      shell: {
        subtitle: '构建、运行并观察自动化 Pipeline',
      },
    },
  },
  en: {
    translation: {
      views: {
        pipelines: 'Pipelines',
        fileBrowser: 'File Browser',
        servers: 'Servers',
        settings: 'Settings',
      },
      descriptions: {
        pipelines: 'Compose ExecutionUnits and Commands',
        fileBrowser: 'Browse local and remote files',
        servers: 'Manage remote SSH connection targets',
        settings: 'Configure application preferences',
      },
      actions: {
        language: '中文',
      },
      shell: {
        subtitle: 'Build, run, and observe automation Pipelines',
      },
    },
  },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
