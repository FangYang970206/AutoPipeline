import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import i18n from './i18n';
import { useAppStore } from './store/appStore';

describe('App shell', () => {
  beforeEach(() => {
    useAppStore.setState({ activeView: 'pipelines' });
    void i18n.changeLanguage('zh-CN');
  });

  it('renders the zh-CN activity shell by default and switches views', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: '流水线' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '服务器' }));

    expect(screen.getByRole('heading', { level: 1, name: '服务器' })).toBeInTheDocument();
    expect(screen.getAllByText('管理远程 SSH 连接目标')).not.toHaveLength(0);
  });

  it('supports switching to English labels', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'English' }));

    expect(screen.getByRole('button', { name: 'Servers' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Pipelines' })).toBeInTheDocument();
  });
});
