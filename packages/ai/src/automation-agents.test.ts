import { describe, expect, it } from 'vitest';
import {
  automationRepairAgent,
  automationWriterAgent,
  FakeProvider,
  failureAnalysisAgent,
  runAgent,
  specFileName,
  type StructuredRequest,
} from './index';
import type { z } from 'zod';

const tc = {
  ref: 'TC-0031',
  title: 'Apply an expired discount code',
  preconditions: 'Signed in as shopper',
  steps: [{ action: 'Enter SUMMER10 and apply', expected: 'Error "Code expired"' }],
  testData: null,
};

describe('Automation Agent: generate', () => {
  it('cleans the code, names the file, and lists env vars without values', async () => {
    let seen: StructuredRequest<z.ZodType> | undefined;
    const provider = new FakeProvider((req) => {
      seen = req;
      return {
        fileName: 'x.ts',
        code: "```ts\ntest('apply', async ({ page }) => { await page.goto('/'); await page.getByLabel('Password').fill(process.env.SHOP_PASSWORD!); await page.getByLabel('Card').fill(process.env.CARD!); });\n```",
        envVars: [],
        assumptions: ['Discount field label is a guess'],
        confidence: 1.4,
      };
    });
    const run = await runAgent(
      automationWriterAgent,
      {
        projectName: 'Shop',
        testCase: tc,
        baseUrl: 'https://shop.test',
        envVarNames: ['SHOP_PASSWORD'],
      },
      { provider, model: 'm' },
    );
    expect(run.output.code.startsWith("import { test, expect } from '@playwright/test';")).toBe(
      true,
    );
    expect(run.output.code).not.toContain('```');
    expect(run.output.fileName).toBe('tc-0031-apply-an-expired-discount-code.spec.ts');
    expect(run.output.envVars).toEqual(['SHOP_PASSWORD', 'CARD']);
    expect(run.output.assumptions.at(-1)).toBe('Add these to the environment before running: CARD');
    expect(run.output.confidence).toBe(1);
    expect(run.dropped).toEqual(['added the missing @playwright/test import']);
    const text = seen!.content.map((p) => (p.type === 'text' ? p.text : '')).join('');
    expect(text).toContain('<test_case ref="TC-0031">');
    expect(text).toContain('SHOP_PASSWORD');
    expect(specFileName('TC-1', '!!!')).toBe('tc-1.spec.ts');
  });
});

describe('Automation Agent: repair', () => {
  const code = `import { test, expect } from '@playwright/test';
test('pay', async ({ page }) => {
  await page.getByRole('button', { name: 'Pay now' }).click();
  await expect(page.getByText('Thank you')).toBeVisible();
});`;
  const input = {
    path: 'pay.spec.ts',
    code,
    error: "waiting for getByRole('button', { name: 'Pay now' })",
    pageSnapshot: '- button "Pay $120"',
  };

  it('accepts a small locator fix', async () => {
    const provider = new FakeProvider(() => ({
      isTestProblem: true,
      summary: 'Button renamed',
      fixedCode: code.replace('Pay now', 'Pay $120'),
      changes: [{ line: 3, before: 'Pay now', after: 'Pay $120', evidence: '- button "Pay $120"' }],
      confidence: 0.9,
    }));
    const run = await runAgent(automationRepairAgent, input, { provider, model: 'm' });
    expect(run.output).toMatchObject({ isTestProblem: true, confidence: 0.9 });
    expect(run.output.fixedCode).toContain("name: 'Pay $120'");
    expect(run.dropped).toEqual([]);
  });

  it('rejects fixes that delete assertions, and keeps code unchanged for product bugs', async () => {
    const cheat = new FakeProvider(() => ({
      isTestProblem: true,
      summary: '',
      fixedCode: code.replace(/\n\s*await expect.*\n/, '\n'),
      changes: [],
      confidence: 0.95,
    }));
    const r1 = await runAgent(automationRepairAgent, input, { provider: cheat, model: 'm' });
    expect(r1.output).toMatchObject({
      isTestProblem: false,
      confidence: 0,
      fixedCode: code,
    });
    expect(r1.dropped[0]).toMatch(/removed assertions/);
    const product = new FakeProvider(() => ({
      isTestProblem: false,
      summary: 'Product shows an error',
      fixedCode: 'whatever',
      changes: [],
      confidence: 0.7,
    }));
    expect(
      (await runAgent(automationRepairAgent, input, { provider: product, model: 'm' })).output
        .fixedCode,
    ).toBe(code);
  });
});

describe('Failure Analysis Agent', () => {
  const base = {
    kind: 'api' as const,
    name: 'Get order',
    error: 'Status 503, expected eq 200',
    exchange: '503 Service Unavailable from gateway',
  };
  it('keeps grounded classifications', async () => {
    const provider = new FakeProvider(() => ({
      failureClass: 'ENVIRONMENT',
      confidence: 0.8,
      reasoning: 'Gateway',
      evidence: 'Status 503, expected eq 200',
      suggestedAction: 'Check staging',
      locatorIssue: true,
    }));
    const r = await runAgent(failureAnalysisAgent, base, { provider, model: 'm' });
    expect(r.output).toMatchObject({
      failureClass: 'ENVIRONMENT',
      confidence: 0.8,
      locatorIssue: false,
    });
    expect(r.dropped).toEqual([]);
  });
  it('lowers confidence for invented evidence and forces FLAKY when a retry passed', async () => {
    const provider = new FakeProvider(() => ({
      failureClass: 'PRODUCT_BUG',
      confidence: 0.95,
      reasoning: '',
      evidence: 'NullPointerException in OrderService',
      suggestedAction: '',
      locatorIssue: false,
    }));
    const r = await runAgent(
      failureAnalysisAgent,
      { ...base, kind: 'ui', flaky: true },
      { provider, model: 'm' },
    );
    expect(r.output).toMatchObject({ failureClass: 'FLAKY', confidence: 0.5 });
    expect(r.dropped).toHaveLength(2);
  });
});
