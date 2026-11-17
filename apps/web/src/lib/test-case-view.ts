import type { AutomationStatus, Priority, TestCaseStatus, TestCaseType } from '@qaforge/shared';

export const TC_COLUMNS = [
  { id: 'ref', label: 'ID', required: true },
  { id: 'title', label: 'Title', required: true },
  { id: 'status', label: 'Status' },
  { id: 'priority', label: 'Priority' },
  { id: 'type', label: 'Type' },
  { id: 'technique', label: 'Technique' },
  { id: 'automationStatus', label: 'Automation' },
  { id: 'suite', label: 'Suite' },
  { id: 'requirements', label: 'Requirements' },
  { id: 'tags', label: 'Tags' },
  { id: 'stepCount', label: 'Steps' },
  { id: 'updatedAt', label: 'Updated' },
] as const;
export type TcColumnId = (typeof TC_COLUMNS)[number]['id'];

export const GROUP_BY = ['none', 'status', 'priority', 'type', 'suite'] as const;
export type GroupBy = (typeof GROUP_BY)[number];

/** Everything a saved view captures. Suite selection is navigation, not part of the view. */
export interface TestCaseViewState {
  q: string;
  status: TestCaseStatus[];
  priority: Priority[];
  type: TestCaseType[];
  automationStatus: AutomationStatus[];
  tag: string;
  aiGenerated: boolean | null;
  sort: 'seq' | 'title' | 'priority' | 'status' | 'updatedAt' | 'createdAt';
  dir: 'asc' | 'desc';
  columns: TcColumnId[];
  groupBy: GroupBy;
  layout: 'table' | 'cards';
  pageSize: number;
}

export const DEFAULT_VIEW: TestCaseViewState = {
  q: '',
  status: [],
  priority: [],
  type: [],
  automationStatus: [],
  tag: '',
  aiGenerated: null,
  sort: 'seq',
  dir: 'desc',
  columns: ['ref', 'title', 'status', 'priority', 'suite', 'requirements', 'updatedAt'],
  groupBy: 'none',
  layout: 'table',
  pageSize: 50,
};

/** Built-in "AI review queue": drafts and cases waiting in review. */
export const REVIEW_VIEW: TestCaseViewState = {
  ...DEFAULT_VIEW,
  status: ['DRAFT', 'IN_REVIEW'],
  sort: 'updatedAt',
  dir: 'desc',
};

/** Rows per page offered in the list footer (pages over 100 rows are virtualised). */
export const PAGE_SIZES = [50, 100, 250, 500];

/** Merge a stored (possibly older/partial) config over defaults, dropping unknown values. */
export function normalizeView(config: unknown): TestCaseViewState {
  const c = (config && typeof config === 'object' ? config : {}) as Partial<TestCaseViewState>;
  const arr = <T>(v: unknown, fallback: T[]): T[] => (Array.isArray(v) ? (v as T[]) : fallback);
  return {
    ...DEFAULT_VIEW,
    ...c,
    status: arr(c.status, []),
    priority: arr(c.priority, []),
    type: arr(c.type, []),
    automationStatus: arr(c.automationStatus, []),
    columns: arr<TcColumnId>(c.columns, DEFAULT_VIEW.columns).filter((id) =>
      TC_COLUMNS.some((col) => col.id === id),
    ),
    groupBy: GROUP_BY.includes(c.groupBy as GroupBy) ? (c.groupBy as GroupBy) : 'none',
    pageSize: PAGE_SIZES.includes(c.pageSize as number)
      ? (c.pageSize as number)
      : DEFAULT_VIEW.pageSize,
  };
}

export function toQueryString(
  v: TestCaseViewState,
  extra: { suiteId?: string; page?: number } = {},
): string {
  const qs = new URLSearchParams();
  if (v.q.trim()) qs.set('q', v.q.trim());
  if (v.status.length) qs.set('status', v.status.join(','));
  if (v.priority.length) qs.set('priority', v.priority.join(','));
  if (v.type.length) qs.set('type', v.type.join(','));
  if (v.automationStatus.length) qs.set('automationStatus', v.automationStatus.join(','));
  if (v.tag) qs.set('tag', v.tag);
  if (v.aiGenerated !== null) qs.set('aiGenerated', String(v.aiGenerated));
  if (extra.suiteId) qs.set('suiteId', extra.suiteId);
  qs.set('sort', v.sort);
  qs.set('dir', v.dir);
  qs.set('page', String(extra.page ?? 1));
  qs.set('pageSize', String(v.pageSize));
  return qs.toString();
}

export function activeFilterCount(v: TestCaseViewState): number {
  return [
    v.q.trim(),
    v.status.length,
    v.priority.length,
    v.type.length,
    v.automationStatus.length,
    v.tag,
    v.aiGenerated !== null,
  ].filter(Boolean).length;
}
