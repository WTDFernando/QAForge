import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { useHotkey } from '@/hooks/use-hotkey';

function Harness({ combo, fn }: { combo: string; fn: () => void }) {
  useHotkey(combo, fn);
  return <input aria-label="field" />;
}

describe('useHotkey', () => {
  it('fires mod combos even while typing', () => {
    const fn = vi.fn();
    const { getByLabelText } = render(<Harness combo="mod+k" fn={fn} />);
    fireEvent.keyDown(getByLabelText('field'), { key: 'k', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.keyDown(window, { key: 'k' });
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it('ignores single keys while typing in a field', () => {
    const fn = vi.fn();
    const { getByLabelText } = render(<Harness combo="c" fn={fn} />);
    fireEvent.keyDown(getByLabelText('field'), { key: 'c' });
    fireEvent.keyDown(window, { key: 'c' });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
