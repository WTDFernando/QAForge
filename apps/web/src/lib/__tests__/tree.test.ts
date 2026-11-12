import { describe, expect, it } from 'vitest';
import { buildTree, descendantIds, filterTree, flattenTree } from '../tree';

const rows = [
  { id: 'b', parentId: null, position: 1, title: 'Beta' },
  { id: 'a', parentId: null, position: 0, title: 'Alpha' },
  { id: 'a2', parentId: 'a', position: 1, title: 'Second' },
  { id: 'a1', parentId: 'a', position: 0, title: 'First' },
  { id: 'a1x', parentId: 'a1', position: 0, title: 'Deep match' },
  { id: 'orphan', parentId: 'gone', position: 5, title: 'Orphan' },
];

describe('tree utils', () => {
  it('builds a sorted forest and adopts orphans as roots', () => {
    const t = buildTree(rows);
    expect(t.map((n) => n.item.id)).toEqual(['a', 'b', 'orphan']);
    expect(t[0]!.children.map((n) => n.item.id)).toEqual(['a1', 'a2']);
    expect(t[0]!.children[0]!.children[0]!.depth).toBe(2);
  });
  it('flattens respecting collapsed nodes', () => {
    const t = buildTree(rows);
    expect(flattenTree(t, new Set()).map((n) => n.item.id)).toEqual([
      'a',
      'a1',
      'a1x',
      'a2',
      'b',
      'orphan',
    ]);
    expect(flattenTree(t, new Set(['a'])).map((n) => n.item.id)).toEqual(['a', 'b', 'orphan']);
  });
  it('filters keeping ancestors of matches', () => {
    const t = filterTree(buildTree(rows), (r) => r.title.includes('Deep'));
    expect(flattenTree(t, new Set()).map((n) => n.item.id)).toEqual(['a', 'a1', 'a1x']);
  });
  it('collects descendants', () => {
    expect([...descendantIds(buildTree(rows), 'a')].sort()).toEqual(['a', 'a1', 'a1x', 'a2']);
    expect(descendantIds(buildTree(rows), 'nope').size).toBe(0);
  });
});
