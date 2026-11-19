/**
 * Human-readable item refs, unique within a project: TC-0142, REQ-0007, BUG-0031.
 * (The project is implied by context; across projects show "PAY · TC-0142".)
 */
export const ENTITY_PREFIX = {
  requirement: 'REQ',
  testCase: 'TC',
  testRun: 'RUN',
  bug: 'BUG',
  release: 'REL',
  automationRun: 'AUT',
} as const;
export type EntityKind = keyof typeof ENTITY_PREFIX;

export function formatRef(kind: EntityKind, seq: number): string {
  return `${ENTITY_PREFIX[kind]}-${String(seq).padStart(4, '0')}`;
}

export function parseRef(ref: string): { kind: EntityKind; seq: number } | null {
  const m = /^([A-Z]+)-(\d+)$/.exec(ref.trim().toUpperCase());
  if (!m) return null;
  const kind = (Object.keys(ENTITY_PREFIX) as EntityKind[]).find((k) => ENTITY_PREFIX[k] === m[1]);
  if (!kind) return null;
  const seq = Number(m[2]);
  return seq > 0 ? { kind, seq } : null;
}
