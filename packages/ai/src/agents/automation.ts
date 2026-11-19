import { z } from 'zod';
import { tagSafe, type AgentDefinition } from './types';

// ---- generate ----------------------------------------------------------------------

export const automationWriterInput = z.object({
  projectName: z.string(),
  testCase: z.object({
    ref: z.string(),
    title: z.string(),
    preconditions: z.string(),
    steps: z.array(z.object({ action: z.string(), expected: z.string() })),
    testData: z
      .object({ columns: z.array(z.string()), rows: z.array(z.array(z.string())) })
      .nullable(),
  }),
  baseUrl: z.string().nullable(),
  /** Names only: the agent may reference these as process.env.NAME */
  envVarNames: z.array(z.string()).default([]),
  /** Accessibility snapshot of the start page, when available */
  pageSnapshot: z.string().max(60_000).nullable().default(null),
});
export type AutomationWriterInput = z.infer<typeof automationWriterInput>;

export const automationWriterOutput = z.object({
  fileName: z.string(),
  code: z.string(),
  envVars: z.array(z.string()),
  assumptions: z.array(z.string()),
  confidence: z.number(),
});
export type AutomationWriterOutput = z.infer<typeof automationWriterOutput>;

const stripFences = (code: string) =>
  code
    .replace(/^\s*```[a-z]*\n/i, '')
    .replace(/\n```\s*$/i, '')
    .trim() + '\n';

/** Slug for the file name, e.g. "TC-0031" + "Apply an expired code" -> "tc-0031-apply-an-expired-code.spec.ts" */
export function specFileName(ref: string, title: string) {
  const slug = `${ref}-${title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .replace(/-$/, '');
  return `${slug || 'test'}.spec.ts`;
}

export const automationWriterAgent: AgentDefinition<
  typeof automationWriterInput,
  typeof automationWriterOutput
> = {
  id: 'automation',
  name: 'Automation Agent',
  description: 'Writes a Playwright test with a page object from a manual test case.',
  promptVersion: 'v1',
  effort: 'medium',
  input: automationWriterInput,
  output: automationWriterOutput,
  buildContent(input) {
    const t = input.testCase;
    const steps =
      t.steps
        .map(
          (s, i) =>
            `${i + 1}. ${tagSafe(s.action)}\n   Expected: ${tagSafe(s.expected) || '(none)'}`,
        )
        .join('\n') || '(no steps)';
    const data = t.testData
      ? `${t.testData.columns.join(' | ')}\n${t.testData.rows.map((r) => r.join(' | ')).join('\n')}`
      : '(none)';
    return [
      {
        type: 'text',
        text: `Project: ${tagSafe(input.projectName)}\nBase URL: ${input.baseUrl ?? '(not set)'}\nEnvironment variables available: ${input.envVarNames.join(', ') || '(none)'}\n\n<test_case ref="${t.ref}">\nTitle: ${tagSafe(t.title)}\nPreconditions: ${tagSafe(t.preconditions) || '(none)'}\nSteps:\n${steps}\nTest data:\n${data}\n</test_case>${
          input.pageSnapshot
            ? `\n\n<page_snapshot>\n${tagSafe(input.pageSnapshot)}\n</page_snapshot>`
            : ''
        }`,
      },
    ];
  },
  postprocess(input, out) {
    const dropped: string[] = [];
    let code = stripFences(out.code);
    if (!/from ['"]@playwright\/test['"]/.test(code)) {
      code = `import { test, expect } from '@playwright/test';\n${code}`;
      dropped.push('added the missing @playwright/test import');
    }
    if (!/\btest\s*\(/.test(code)) dropped.push('the code contains no test() call');
    // Only environment variables that exist (names, never values).
    const known = new Set(input.envVarNames);
    const envVars = [
      ...new Set([...code.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]!)),
    ];
    const unknown = envVars.filter((v) => !known.has(v));
    return {
      output: {
        ...out,
        code,
        fileName: specFileName(input.testCase.ref, input.testCase.title),
        envVars,
        assumptions: [
          ...out.assumptions,
          ...(unknown.length
            ? [`Add these to the environment before running: ${unknown.join(', ')}`]
            : []),
        ],
        confidence: Math.max(0, Math.min(1, Math.round(out.confidence * 100) / 100)),
      },
      dropped,
    };
  },
};

// ---- repair -----------------------------------------------------------------------------

export const automationRepairInput = z.object({
  path: z.string(),
  code: z.string(),
  error: z.string(),
  pageSnapshot: z.string().max(60_000).nullable(),
});
export type AutomationRepairInput = z.infer<typeof automationRepairInput>;

export const automationRepairOutput = z.object({
  isTestProblem: z.boolean(),
  summary: z.string(),
  fixedCode: z.string(),
  changes: z.array(
    z.object({ line: z.number(), before: z.string(), after: z.string(), evidence: z.string() }),
  ),
  confidence: z.number(),
});
export type AutomationRepairOutput = z.infer<typeof automationRepairOutput>;

const lines = (s: string) => s.replace(/\r\n/g, '\n').split('\n');
const assertionCount = (s: string) => (s.match(/\bexpect\s*\(/g) ?? []).length;

export const automationRepairAgent: AgentDefinition<
  typeof automationRepairInput,
  typeof automationRepairOutput
> = {
  id: 'automation',
  prompt: 'automation-repair',
  name: 'Automation Agent',
  description: 'Suggests the smallest locator fix for a failed Playwright test.',
  promptVersion: 'v1',
  effort: 'medium',
  input: automationRepairInput,
  output: automationRepairOutput,
  buildContent(input) {
    const numbered = lines(input.code)
      .map((l, i) => `${String(i + 1).padStart(3)}| ${l}`)
      .join('\n');
    return [
      {
        type: 'text',
        text: `<test_file path="${tagSafe(input.path)}">\n${tagSafe(numbered)}\n</test_file>\n\n<error>\n${tagSafe(input.error.slice(0, 8000))}\n</error>\n\n<page_snapshot>\n${input.pageSnapshot ? tagSafe(input.pageSnapshot) : '(not available)'}\n</page_snapshot>`,
      },
    ];
  },
  postprocess(input, out) {
    const dropped: string[] = [];
    let fixed = stripFences(out.fixedCode);
    let isTestProblem = out.isTestProblem;
    let confidence = Math.max(0, Math.min(1, out.confidence));
    if (!isTestProblem) fixed = input.code;
    // Never accept a "fix" that removes assertions to make the test pass.
    if (isTestProblem && assertionCount(fixed) < assertionCount(input.code)) {
      dropped.push('the suggested fix removed assertions, so it was rejected');
      fixed = input.code;
      isTestProblem = false;
      confidence = 0;
    }
    const before = lines(input.code);
    const after = lines(fixed);
    const changed =
      after.filter((l, i) => l !== before[i]).length + Math.abs(after.length - before.length);
    if (isTestProblem && changed === 0) dropped.push('no code change was suggested');
    if (changed > Math.max(10, before.length * 0.3)) {
      dropped.push(`the fix changes ${changed} lines; review it carefully`);
      confidence = Math.min(confidence, 0.4);
    }
    return {
      output: {
        ...out,
        isTestProblem,
        fixedCode: fixed,
        confidence: Math.round(confidence * 100) / 100,
      },
      dropped,
    };
  },
};
