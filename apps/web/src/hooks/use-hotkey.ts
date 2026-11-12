'use client';
import { useEffect } from 'react';

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

/**
 * Register a keyboard shortcut. `combo` is e.g. "mod+k" (Cmd on macOS, Ctrl elsewhere) or "c".
 * Single-key shortcuts are ignored while the user is typing in a field.
 */
export function useHotkey(combo: string, handler: (e: KeyboardEvent) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const parts = combo.toLowerCase().split('+');
    const key = parts.pop()!;
    const needsMod = parts.includes('mod');
    const needsShift = parts.includes('shift');
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== key) return;
      const mod = e.metaKey || e.ctrlKey;
      if (needsMod !== mod || needsShift !== e.shiftKey || e.altKey) return;
      if (!needsMod && isTyping(e.target)) return;
      e.preventDefault();
      handler(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [combo, handler, enabled]);
}
