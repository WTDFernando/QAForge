export interface TreeNode<T> {
  item: T;
  children: TreeNode<T>[];
  depth: number;
}

/** Build a sorted forest from flat rows. Rows whose parent is missing become roots. */
export function buildTree<T extends { id: string; parentId: string | null; position: number }>(
  rows: T[],
): TreeNode<T>[] {
  const byParent = new Map<string | null, T[]>();
  const ids = new Set(rows.map((r) => r.id));
  for (const r of rows) {
    const key = r.parentId && ids.has(r.parentId) ? r.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), r]);
  }
  const make = (parent: string | null, depth: number): TreeNode<T>[] =>
    (byParent.get(parent) ?? [])
      .sort((a, b) => a.position - b.position)
      .map((item) => ({ item, depth, children: make(item.id, depth + 1) }));
  return make(null, 0);
}

/** Depth-first list of visible nodes given the set of collapsed ids. */
export function flattenTree<T extends { id: string }>(
  nodes: TreeNode<T>[],
  collapsed: Set<string>,
): TreeNode<T>[] {
  const out: TreeNode<T>[] = [];
  const walk = (list: TreeNode<T>[]) => {
    for (const n of list) {
      out.push(n);
      if (!collapsed.has(n.item.id)) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** Keep nodes that match (and their ancestors), for search. */
export function filterTree<T>(nodes: TreeNode<T>[], match: (item: T) => boolean): TreeNode<T>[] {
  return nodes.flatMap((n) => {
    const children = filterTree(n.children, match);
    return match(n.item) || children.length ? [{ ...n, children }] : [];
  });
}

/** ids of the node and all its descendants. */
export function descendantIds<T extends { id: string }>(
  nodes: TreeNode<T>[],
  id: string,
): Set<string> {
  const out = new Set<string>();
  const collect = (n: TreeNode<T>) => {
    out.add(n.item.id);
    n.children.forEach(collect);
  };
  const find = (list: TreeNode<T>[]): boolean =>
    list.some((n) => (n.item.id === id ? (collect(n), true) : find(n.children)));
  find(nodes);
  return out;
}
