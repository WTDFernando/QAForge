'use client';
import * as React from 'react';

interface UiState {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  createProjectOpen: boolean;
  setCreateProjectOpen: (open: boolean) => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  copilotOpen: boolean;
  setCopilotOpen: (open: boolean) => void;
  /** Context-aware "create" (the C shortcut): pages register what C creates there. */
  createAction: { label: string; run: () => void } | null;
  setCreateAction: (a: { label: string; run: () => void } | null) => void;
}

const Ctx = React.createContext<UiState | null>(null);

export function UiStateProvider({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [createProjectOpen, setCreateProjectOpen] = React.useState(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [copilotOpen, setCopilotOpen] = React.useState(false);
  const [createAction, setCreateAction] = React.useState<UiState['createAction']>(null);
  const value = React.useMemo(
    () => ({
      paletteOpen,
      setPaletteOpen,
      createProjectOpen,
      setCreateProjectOpen,
      mobileNavOpen,
      setMobileNavOpen,
      copilotOpen,
      setCopilotOpen,
      createAction,
      setCreateAction,
    }),
    [paletteOpen, createProjectOpen, mobileNavOpen, copilotOpen, createAction],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUiState() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error('useUiState must be used within UiStateProvider');
  return ctx;
}

/** Register what the "C" shortcut / palette "Create…" does on the current page. */
export function useCreateAction(label: string, run: (() => void) | null) {
  const { setCreateAction } = useUiState();
  const ref = React.useRef(run);
  React.useEffect(() => {
    ref.current = run;
  });
  const enabled = !!run;
  React.useEffect(() => {
    if (!enabled) return;
    setCreateAction({ label, run: () => ref.current?.() });
    return () => setCreateAction(null);
  }, [label, enabled, setCreateAction]);
}
