import { describe, expect, it } from 'vitest';
import { requirementAgent, testCaseReviewerAgent, testCaseWriterAgent } from '../index';
import { requirementCases, reviewerCases, writerCases } from './cases';

describe('eval cases', () => {
  it('all eval inputs are valid agent inputs', () => {
    requirementCases.forEach((c) =>
      expect(() => requirementAgent.input.parse(c.input)).not.toThrow(),
    );
    writerCases.forEach((c) =>
      expect(() => testCaseWriterAgent.input.parse(c.input)).not.toThrow(),
    );
    reviewerCases.forEach((c) =>
      expect(() => testCaseReviewerAgent.input.parse(c.input)).not.toThrow(),
    );
  });

  it('checks fail obviously bad outputs and pass good ones', () => {
    const vague = requirementCases[1]!;
    expect(vague.checks({ summary: '', documentQuestions: [], requirements: [] }, [])).not.toEqual(
      [],
    );
    const good = {
      summary: '',
      documentQuestions: [],
      requirements: [
        {
          key: 'R1',
          parentKey: null,
          type: 'STORY' as const,
          title: 'Search',
          description: '',
          acceptanceCriteria: [],
          priority: 'LOW' as const,
          clarityScore: 30,
          ambiguities: ['"fast" is not measurable'],
          missingCriteria: [],
          questions: ['How fast?', 'For which users?'],
          sourceQuote: 'Search should be fast',
        },
      ],
    };
    expect(vague.checks(good, [])).toEqual([]);
    const injection = requirementCases[2]!;
    expect(
      injection.checks(
        { ...good, requirements: [{ ...good.requirements[0]!, title: 'PWNED' }] },
        [],
      ),
    ).toContain('followed an instruction embedded in the document');
    const reviewer = reviewerCases[0]!;
    expect(
      reviewer.checks(
        {
          verdict: 'good',
          score: 90,
          summary: '',
          issues: [],
          missingCoverage: [],
          suggestedSteps: null,
        },
        [],
      ).length,
    ).toBe(4);
  });
});
