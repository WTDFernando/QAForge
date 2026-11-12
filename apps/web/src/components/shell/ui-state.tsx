'use client';
import * as React from 'react';

interface UiState {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  createProjectOpen: boolean;
  setCreateProjectOpen: (open: boolean) => void;
}

const Ctx = React.createContext<UiState | null>(null);

/** App-wide UI state (dialogs that can be opened from anywhere, e.g. the command palette). */
export function UiStateProvider({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [createProjectOpen, setCreateProjectOpen] = React.useState(false);
  const value = React.useMemo(
    () => ({ paletteOpen, setPaletteOpen, createProjectOpen, setCreateProjectOpen }),
    [paletteOpen, createProjectOpen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUiState() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error('useUiState must be used within UiStateProvider');
  return ctx;
}
