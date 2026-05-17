import { create } from 'zustand';
import type { ViewId } from '../types';

interface AppState {
  activeView: ViewId;
  setActiveView: (view: ViewId) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeView: 'pipelines',
  setActiveView: (view) => set({ activeView: view }),
}));
