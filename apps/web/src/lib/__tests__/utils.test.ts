import { describe, expect, it } from 'vitest';
import { initials, slugify, suggestProjectKey, timeAgo } from '../utils';

describe('utils', () => {
  it('initials', () => {
    expect(initials('Olivia Owner')).toBe('OO');
    expect(initials('  cher ')).toBe('C');
  });
  it('slugify', () => {
    expect(slugify('Acme Corp!')).toBe('acme-corp');
    expect(slugify('Ünïcode Team')).toBe('unicode-team');
  });
  it('suggestProjectKey', () => {
    expect(suggestProjectKey('Payments')).toBe('PAY');
    expect(suggestProjectKey('Mobile App')).toBe('MA');
    expect(suggestProjectKey('2024 roadmap')).toBe('P2R');
    expect(suggestProjectKey('')).toBe('');
  });
  it('timeAgo', () => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    expect(timeAgo('2026-01-01T11:59:50Z', now)).toBe('just now');
    expect(timeAgo('2026-01-01T11:55:00Z', now)).toBe('5 minutes ago');
    expect(timeAgo('2025-12-31T12:00:00Z', now)).toBe('yesterday');
  });
});
