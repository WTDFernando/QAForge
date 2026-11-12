import { describe, expect, it } from 'vitest';
import {
  bulkTestCaseSchema,
  canTransition,
  createTestCaseSchema,
  environmentSchema,
  humanize,
  moduleEnabled,
  richTextToPlain,
  testCaseQuerySchema,
  testDataSchema,
  updateEnvironmentSchema,
  updateRequirementSchema,
  updateTestCaseSchema,
} from './qa';

describe('qa contracts', () => {
  it('humanizes enum values', () => {
    expect(humanize('DECISION_TABLE')).toBe('Decision table');
  });

  it('enforces the review workflow', () => {
    expect(canTransition('DRAFT', 'APPROVED')).toBe(true);
    expect(canTransition('DEPRECATED', 'APPROVED')).toBe(false);
    expect(canTransition('APPROVED', 'APPROVED')).toBe(true);
  });

  it('defaults core modules on and future modules off', () => {
    expect(moduleEnabled({}, 'testCases')).toBe(true);
    expect(moduleEnabled(null, 'performance')).toBe(false);
    expect(moduleEnabled({ modules: { performance: true, bugs: false } }, 'performance')).toBe(
      true,
    );
    expect(moduleEnabled({ modules: { bugs: false } }, 'bugs')).toBe(false);
  });

  it('flattens rich text', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'Login' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'User ' },
            { type: 'text', text: 'signs in' },
            { type: 'hardBreak' },
            { type: 'text', text: 'fast' },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }],
            },
          ],
        },
      ],
    };
    expect(richTextToPlain(doc)).toBe('Login\nUser signs in\nfast\nitem');
    expect(richTextToPlain(null)).toBe('');
  });

  it('applies test case defaults and normalizes tags', () => {
    const tc = createTestCaseSchema.parse({ title: 'Login works', tags: ['Smoke'] });
    expect(tc).toMatchObject({ status: 'DRAFT', priority: 'MEDIUM', steps: [], tags: ['smoke'] });
  });

  it('validates parameterised test data shape', () => {
    expect(testDataSchema.safeParse({ columns: ['user'], rows: [['a'], ['b']] }).success).toBe(
      true,
    );
    expect(testDataSchema.safeParse({ columns: ['user', 'pw'], rows: [['a']] }).success).toBe(
      false,
    );
  });

  it('parses list queries from query strings', () => {
    const q = testCaseQuerySchema.parse({ status: 'DRAFT,APPROVED', deep: 'false', page: '2' });
    expect(q).toMatchObject({
      status: ['DRAFT', 'APPROVED'],
      deep: false,
      page: 2,
      pageSize: 50,
      sort: 'seq',
    });
    expect(testCaseQuerySchema.safeParse({ status: 'NOPE' }).success).toBe(false);
  });

  it('validates bulk actions by type', () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expect(
      bulkTestCaseSchema.safeParse({ action: 'setStatus', ids: [id], status: 'APPROVED' }).success,
    ).toBe(true);
    expect(bulkTestCaseSchema.safeParse({ action: 'setStatus', ids: [id] }).success).toBe(false);
  });

  it('update schemas never fill in defaults (PATCH semantics)', () => {
    expect(updateTestCaseSchema.parse({ title: 'x' })).toEqual({ title: 'x' });
    expect(updateRequirementSchema.parse({})).toEqual({});
    expect(updateEnvironmentSchema.parse({ name: 'Dev' })).toEqual({ name: 'Dev' });
    expect(updateTestCaseSchema.safeParse({ priority: 'NOPE' }).success).toBe(false);
  });

  it('validates environments', () => {
    expect(environmentSchema.parse({ name: 'Staging', baseUrl: '' }).baseUrl).toBeUndefined();
    expect(
      environmentSchema.safeParse({ name: 'Prod', variables: { 'bad key': 'x' } }).success,
    ).toBe(false);
  });
});
