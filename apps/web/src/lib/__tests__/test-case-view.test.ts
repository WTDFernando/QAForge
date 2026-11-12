import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  DEFAULT_VIEW,
  normalizeView,
  REVIEW_VIEW,
  toQueryString,
} from '../test-case-view';

describe('test case view state', () => {
  it('serializes filters to the API query string', () => {
    const qs = toQueryString(
      {
        ...DEFAULT_VIEW,
        q: ' login ',
        status: ['DRAFT', 'APPROVED'],
        tag: 'smoke',
        aiGenerated: true,
      },
      { suiteId: 'none', page: 3 },
    );
    const p = new URLSearchParams(qs);
    expect(Object.fromEntries(p)).toEqual({
      q: 'login',
      status: 'DRAFT,APPROVED',
      tag: 'smoke',
      aiGenerated: 'true',
      suiteId: 'none',
      sort: 'seq',
      dir: 'desc',
      page: '3',
      pageSize: '50',
    });
  });
  it('omits empty filters', () => {
    expect(toQueryString(DEFAULT_VIEW)).toBe('sort=seq&dir=desc&page=1&pageSize=50');
  });
  it('normalizes stored configs defensively', () => {
    const v = normalizeView({
      status: 'DRAFT',
      columns: ['ref', 'bogus', 'tags'],
      groupBy: 'nope',
      pageSize: 100,
    });
    expect(v.status).toEqual([]);
    expect(v.columns).toEqual(['ref', 'tags']);
    expect(v.groupBy).toBe('none');
    expect(v.pageSize).toBe(100);
    expect(normalizeView(null)).toEqual(DEFAULT_VIEW);
  });
  it('counts active filters', () => {
    expect(activeFilterCount(DEFAULT_VIEW)).toBe(0);
    expect(activeFilterCount(REVIEW_VIEW)).toBe(1);
  });
});
