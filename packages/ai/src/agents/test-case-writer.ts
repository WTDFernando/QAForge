import { z } from 'zod';
import { PRIORITIES, REQUIREMENT_TYPES, TEST_CASE_TYPES, TEST_TECHNIQUES } from '@qaforge/shared';
import { tagSafe, type AgentDefinition } from './types';

export const writerInput = z.object({
  projectName: z.string(),
  requirements: z
    .array(
      z.object({
        ref: z.string(),
        type: z.enum(REQUIREMENT_TYPES),
        title: z.string(),
        description: z.string(),
        acceptanceCriteria: z.array(z.string()),
        priority: z.enum(PRIORITIES),
        existingTestCases: z.array(z.object({ ref: z.string(), title: z.string() })).default([]),
      }),
    )
    .min(1),
  /** Other test case titles in the project, to avoid duplicates. */
  projectTestCaseTitles: z.array(z.string()).default([]),
  maxCasesPerRequirement: z.number().int().min(1).max(20).default(8),
});
export type WriterInput = z.infer<typeof writerInput>;

export const writerOutput = z.object({
  testCases: z.array(
    z.object({
      requirementRefs: z.array(z.string()),
      coversCriteria: z.array(z.string()),
      title: z.string(),
      preconditions: z.string(),
      steps: z.array(z.object({ action: z.string(), expected: z.string() })),
      testData: z
        .object({ columns: z.array(z.string()), rows: z.array(z.array(z.string())) })
        .nullable(),
      priority: z.enum(PRIORITIES),
      type: z.enum(TEST_CASE_TYPES),
      technique: z.enum(TEST_TECHNIQUES),
      tags: z.array(z.string()),
      confidence: z.number(),
      rationale: z.string(),
    }),
  ),
  skipped: z.array(
    z.object({ requirementRef: z.string(), reason: z.string(), question: z.string() }),
  ),
  coverageNotes: z.string(),
});
export type WriterOutput = z.infer<typeof writerOutput>;

export const testCaseWriterAgent: AgentDefinition<typeof writerInput, typeof writerOutput> = {
  id: 'test-case-writer',
  name: 'Test Case Writer',
  description:
    'Drafts test cases per requirement using positive, negative, boundary and equivalence techniques.',
  promptVersion: 'v1',
  effort: 'high',
  input: writerInput,
  output: writerOutput,

  buildContent(input) {
    const reqs = input.requirements
      .map((r) => {
        const ac = r.acceptanceCriteria.length
          ? r.acceptanceCriteria.map((c, i) => `AC${i + 1}: ${tagSafe(c)}`).join('\n')
          : '(no acceptance criteria)';
        const existing = r.existingTestCases.length
          ? r.existingTestCases.map((t) => `${t.ref}: ${tagSafe(t.title)}`).join('\n')
          : '(none)';
        return `<requirement ref="${r.ref}" type="${r.type}" priority="${r.priority}">\nTitle: ${tagSafe(r.title)}\nDescription:\n${tagSafe(r.description) || '(none)'}\nAcceptance criteria:\n${ac}\nExisting test cases for this requirement:\n${existing}\n</requirement>`;
      })
      .join('\n\n');
    const others =
      input.projectTestCaseTitles
        .slice(0, 300)
        .map((t) => `- ${tagSafe(t)}`)
        .join('\n') || '(none)';
    return [
      {
        type: 'text',
        text: `Project: ${tagSafe(input.projectName)}\nDraft at most ${input.maxCasesPerRequirement} test cases per requirement.\n\n<requirements>\n${reqs}\n</requirements>\n\n<existing>\nOther test cases in the project:\n${others}\n</existing>`,
      },
    ];
  },

  postprocess(input, out) {
    const refs = new Set(input.requirements.map((r) => r.ref));
    const dropped: string[] = [];
    const perReq = new Map<string, number>();
    const testCases = out.testCases.flatMap((tc) => {
      const requirementRefs = tc.requirementRefs.filter((r) => refs.has(r));
      if (requirementRefs.length === 0)
        return (dropped.push(`"${tc.title}": not linked to any given requirement`), []);
      const steps = tc.steps.filter((s) => s.action.trim());
      if (steps.length === 0) return (dropped.push(`"${tc.title}": no steps`), []);
      if (steps.some((s) => !s.expected.trim()))
        return (dropped.push(`"${tc.title}": a step has no expected result`), []);
      const main = requirementRefs[0]!;
      const n = (perReq.get(main) ?? 0) + 1;
      if (n > input.maxCasesPerRequirement)
        return (dropped.push(`"${tc.title}": over the per-requirement limit`), []);
      perReq.set(main, n);
      const testData =
        tc.testData &&
        tc.testData.columns.length &&
        tc.testData.rows.every((r) => r.length === tc.testData!.columns.length)
          ? tc.testData
          : null;
      return [
        {
          ...tc,
          requirementRefs,
          steps,
          testData,
          tags: [
            ...new Set(
              tc.tags
                .map((t) =>
                  t
                    .toLowerCase()
                    .replace(/[^a-z0-9-]/g, '-')
                    .slice(0, 40),
                )
                .filter(Boolean),
            ),
          ].slice(0, 8),
          confidence: Math.max(0, Math.min(1, tc.confidence)),
        },
      ];
    });
    return {
      output: { ...out, testCases, skipped: out.skipped.filter((s) => refs.has(s.requirementRef)) },
      dropped,
    };
  },
};
