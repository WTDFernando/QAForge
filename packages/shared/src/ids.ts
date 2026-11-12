/** Human-readable entity references, e.g. formatRef('PAY', 'TC', 12) => "PAY-TC-12". */
export const ENTITY_PREFIX = {
  requirement: 'REQ',
  testCase: 'TC',
  testRun: 'RUN',
  bug: 'BUG',
  release: 'REL',
} as const;
export type EntityKind = keyof typeof ENTITY_PREFIX;

export function formatRef(projectKey: string, kind: EntityKind, seq: number): string {
  return `${projectKey}-${ENTITY_PREFIX[kind]}-${seq}`;
}

export function parseRef(
  ref: string,
): { projectKey: string; kind: EntityKind; seq: number } | null {
  const m = /^([A-Z][A-Z0-9]{1,7})-([A-Z]+)-(\d+)$/.exec(ref);
  if (!m) return null;
  const kind = (Object.keys(ENTITY_PREFIX) as EntityKind[]).find((k) => ENTITY_PREFIX[k] === m[2]);
  if (!kind) return null;
  return { projectKey: m[1]!, kind, seq: Number(m[3]) };
}
