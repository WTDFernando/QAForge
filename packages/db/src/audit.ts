export type FieldChanges = Record<string, { from: unknown; to: unknown }>;

const IGNORED = new Set(['updatedAt', 'createdAt']);

function normalize(v: unknown): unknown {
  return v instanceof Date ? v.toISOString() : v;
}

/**
 * Compute a minimal field-level diff between two records for the audit log.
 * Only keys present in `after` are compared (partial updates).
 */
export function diffChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
): FieldChanges {
  const out: FieldChanges = {};
  for (const [key, toRaw] of Object.entries(after)) {
    if (IGNORED.has(key) || toRaw === undefined) continue;
    const from = normalize(before?.[key] ?? null);
    const to = normalize(toRaw);
    if (JSON.stringify(from) !== JSON.stringify(to)) out[key] = { from, to };
  }
  return out;
}
