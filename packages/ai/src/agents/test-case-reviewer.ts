import { z } from 'zod';
import { tagSafe, type AgentDefinition } from './types';

export const reviewerInput = z.object({
  testCase: z.object({
    ref: z.string(),
    title: z.string(),
    preconditions: z.string(),
    steps: z.array(z.object({ action: z.string(), expected: z.string() })),
    testData: z
      .object({ columns: z.array(z.string()), rows: z.array(z.array(z.string())) })
      .nullable(),
    type: z.string(),
    technique: z.string().nullable(),
  }),
  requirements: z.array(
    z.object({ ref: z.string(), title: z.string(), acceptanceCriteria: z.array(z.string()) }),
  ),
  siblingTitles: z.array(z.string()).default([]),
});
export type ReviewerInput = z.infer<typeof reviewerInput>;

export const ISSUE_KINDS = [
  'missing_expected',
  'vague_step',
  'compound_step',
  'missing_precondition',
  'coverage_gap',
  'test_data',
  'duplicate',
  'other',
] as const;

export const reviewerOutput = z.object({
  verdict: z.enum(['good', 'needs_changes']),
  score: z.number(),
  summary: z.string(),
  issues: z.array(
    z.object({
      severity: z.enum(['high', 'medium', 'low']),
      kind: z.enum(ISSUE_KINDS),
      stepNumber: z.number().nullable(),
      message: z.string(),
      suggestion: z.string(),
    }),
  ),
  missingCoverage: z.array(z.string()),
  suggestedSteps: z.array(z.object({ action: z.string(), expected: z.string() })).nullable(),
});
export type ReviewerOutput = z.infer<typeof reviewerOutput>;

export const testCaseReviewerAgent: AgentDefinition<typeof reviewerInput, typeof reviewerOutput> = {
  id: 'test-case-reviewer',
  name: 'Test Case Reviewer',
  description: 'Finds missing expected results, vague steps and coverage gaps, and suggests fixes.',
  promptVersion: 'v1',
  effort: 'medium',
  input: reviewerInput,
  output: reviewerOutput,

  buildContent(input) {
    const t = input.testCase;
    const steps =
      t.steps
        .map(
          (s, i) =>
            `${i + 1}. Action: ${tagSafe(s.action)}\n   Expected: ${tagSafe(s.expected) || '(missing)'}`,
        )
        .join('\n') || '(no steps)';
    const data = t.testData
      ? `${t.testData.columns.join(' | ')}\n${t.testData.rows.map((r) => r.join(' | ')).join('\n')}`
      : '(none)';
    const reqs =
      input.requirements
        .map(
          (r) =>
            `<requirement ref="${r.ref}">\n${tagSafe(r.title)}\n${r.acceptanceCriteria.map((c, i) => `AC${i + 1}: ${tagSafe(c)}`).join('\n') || '(no acceptance criteria)'}\n</requirement>`,
        )
        .join('\n') || '(not linked to any requirement)';
    return [
      {
        type: 'text',
        text: `<test_case ref="${t.ref}" type="${t.type}" technique="${t.technique ?? 'unset'}">\nTitle: ${tagSafe(t.title)}\nPreconditions: ${tagSafe(t.preconditions) || '(none)'}\nSteps:\n${steps}\nTest data:\n${data}\n</test_case>\n\n<requirements>\n${reqs}\n</requirements>\n\n<siblings>\n${
          input.siblingTitles
            .slice(0, 100)
            .map((s) => `- ${tagSafe(s)}`)
            .join('\n') || '(none)'
        }\n</siblings>`,
      },
    ];
  },

  postprocess(input, out) {
    const max = input.testCase.steps.length;
    const dropped: string[] = [];
    const issues = out.issues.filter((i) => {
      if (i.stepNumber !== null && (i.stepNumber < 1 || i.stepNumber > max))
        return (dropped.push(`issue on nonexistent step ${i.stepNumber}`), false);
      return true;
    });
    const hasSerious = issues.some((i) => i.severity !== 'low');
    return {
      output: {
        ...out,
        issues,
        score: Math.max(0, Math.min(100, Math.round(out.score))),
        // Verdict must agree with the issues (rule from the prompt, enforced here).
        verdict: hasSerious ? 'needs_changes' : out.verdict,
        suggestedSteps: out.suggestedSteps?.filter((s) => s.action.trim()) ?? null,
      },
      dropped,
    };
  },
};
