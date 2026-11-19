'use client';
import { useState } from 'react';
import type { AutomationSelection } from '@qaforge/shared';
import { Input } from '@/components/ui/input';
import { useApiTree, useAutomationTests } from '@/hooks/automation';

export function describeSelection(s: AutomationSelection) {
  switch (s.kind) {
    case 'all':
      return 'All enabled tests and collections';
    case 'tests':
      return `${s.testIds.length} UI test${s.testIds.length === 1 ? '' : 's'}`;
    case 'collections':
      return `${s.collectionIds.length} collection${s.collectionIds.length === 1 ? '' : 's'}`;
    case 'tags':
      return `Tagged ${s.tags.join(', ')}`;
  }
}

export function SelectionPicker({
  projectId,
  value,
  onChange,
}: {
  projectId: string;
  value: AutomationSelection;
  onChange: (s: AutomationSelection) => void;
}) {
  const tests = useAutomationTests(projectId);
  const tree = useApiTree(projectId);
  const [tags, setTags] = useState(value.kind === 'tags' ? value.tags.join(', ') : '');
  const kinds: [AutomationSelection['kind'], string][] = [
    ['all', 'Everything'],
    ['tests', 'UI tests'],
    ['collections', 'API collections'],
    ['tags', 'By tag'],
  ];
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">What to run</legend>
      <div role="radiogroup" aria-label="What to run" className="flex flex-wrap gap-1">
        {kinds.map(([k, l]) => (
          <button
            type="button"
            key={k}
            role="radio"
            aria-checked={value.kind === k}
            onClick={() =>
              onChange(
                k === 'all'
                  ? { kind: 'all' }
                  : k === 'tests'
                    ? { kind: 'tests', testIds: [] }
                    : k === 'collections'
                      ? { kind: 'collections', collectionIds: [] }
                      : { kind: 'tags', tags: [] },
              )
            }
            className={`rounded-md border px-2.5 py-1 text-xs font-medium ${value.kind === k ? 'border-primary bg-primary-subtle text-primary' : 'hover:bg-accent'}`}
          >
            {l}
          </button>
        ))}
      </div>
      {value.kind === 'tests' && (
        <ul className="max-h-48 overflow-auto rounded-lg border" aria-label="UI tests">
          {tests.data
            ?.filter((t) => t.status !== 'DISABLED')
            .map((t) => (
              <li key={t.id}>
                <label className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent">
                  <input
                    type="checkbox"
                    checked={value.testIds.includes(t.id)}
                    onChange={() =>
                      onChange({ kind: 'tests', testIds: toggle(value.testIds, t.id) })
                    }
                  />
                  <span className="font-mono text-xs">{t.path}</span>
                </label>
              </li>
            ))}
          {tests.data?.length === 0 && (
            <li className="p-3 text-xs text-muted-foreground">No UI tests yet.</li>
          )}
        </ul>
      )}
      {value.kind === 'collections' && (
        <ul className="max-h-48 overflow-auto rounded-lg border" aria-label="Collections">
          {tree.data
            ?.filter((c) => !c.parentId)
            .map((c) => (
              <li key={c.id}>
                <label className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent">
                  <input
                    type="checkbox"
                    checked={value.collectionIds.includes(c.id)}
                    onChange={() =>
                      onChange({
                        kind: 'collections',
                        collectionIds: toggle(value.collectionIds, c.id),
                      })
                    }
                  />
                  {c.name}
                </label>
              </li>
            ))}
          {tree.data?.length === 0 && (
            <li className="p-3 text-xs text-muted-foreground">No collections yet.</li>
          )}
        </ul>
      )}
      {value.kind === 'tags' && (
        <Input
          aria-label="Tags"
          placeholder="smoke, checkout"
          value={tags}
          onChange={(e) => {
            setTags(e.target.value);
            onChange({
              kind: 'tags',
              tags: e.target.value
                .split(',')
                .map((t) => t.trim().toLowerCase())
                .filter(Boolean),
            });
          }}
        />
      )}
    </fieldset>
  );
}

export function selectionValid(s: AutomationSelection) {
  return (
    s.kind === 'all' ||
    (s.kind === 'tests'
      ? s.testIds.length > 0
      : s.kind === 'collections'
        ? s.collectionIds.length > 0
        : s.tags.length > 0)
  );
}
