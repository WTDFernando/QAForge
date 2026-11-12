'use client';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/** Click-to-edit text. Enter saves, Escape cancels, blur saves. */
export function InlineText({
  value,
  onSave,
  label,
  editable = true,
  className,
  inputClassName,
  multiline = false,
  placeholder,
}: {
  value: string;
  onSave: (v: string) => void;
  label: string;
  editable?: boolean;
  className?: string;
  inputClassName?: string;
  multiline?: boolean;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== value) onSave(next);
    else setDraft(value);
  };

  if (!editable)
    return (
      <span className={className}>
        {value || <span className="text-muted-foreground">{placeholder}</span>}
      </span>
    );
  if (!editing) {
    return (
      <button
        type="button"
        className={cn(
          '-mx-1 rounded px-1 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
          className,
        )}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
      >
        {/* Visible text stays the accessible name (e.g. a heading reads as the title, not "Edit"). */}
        {value || <span className="text-muted-foreground">{placeholder}</span>}
        <span className="sr-only"> (edit {label})</span>
      </button>
    );
  }
  const props = {
    ref,
    value: draft,
    'aria-label': label,
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDraft(value);
        setEditing(false);
      }
      if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        commit();
      }
    },
    className: cn(
      '-mx-1 w-full rounded border border-ring bg-background px-1 outline-none ring-[3px] ring-ring/30',
      className,
      inputClassName,
    ),
  };
  return multiline ? <textarea rows={3} {...props} /> : <input {...props} />;
}
