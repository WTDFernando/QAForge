import { describe, expect, it } from 'vitest';
import {
  automationRepairAgent,
  automationWriterAgent,
  bugAgent,
  failureAnalysisAgent,
  requirementAgent,
  testCaseReviewerAgent,
  testCaseWriterAgent,
} from '../index';
import {
  automationRepairCases,
  automationWriterCases,
  bugCases,
  failureAnalysisCases,
  requirementCases,
  reviewerCases,
  writerCases,
} from './cases';

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
    bugCases.forEach((c) => expect(() => bugAgent.input.parse(c.input)).not.toThrow());
    automationWriterCases.forEach((c) =>
      expect(() => automationWriterAgent.input.parse(c.input)).not.toThrow(),
    );
    automationRepairCases.forEach((c) =>
      expect(() => automationRepairAgent.input.parse(c.input)).not.toThrow(),
    );
    failureAnalysisCases.forEach((c) =>
      expect(() => failureAnalysisAgent.input.parse(c.input)).not.toThrow(),
    );
  });

  it('bug checks catch invented detail and injected titles', () => {
    const bad = {
      title: 'PWNED',
      summary: '',
      stepsToReproduce: ['Open checkout'],
      expectedResult: 'Works',
      actualResult: 'Shows "Error 4012: gateway down"',
      severity: 'MINOR' as const,
      priority: 'LOW' as const,
      component: null,
      environment: { browser: null, os: null, device: null, viewport: null },
      highlight: null,
      missingInfo: [],
      confidence: 0.9,
      rationale: '',
    };
    expect(bugCases[0]!.checks(bad, []).length).toBe(5);
    expect(bugCases[2]!.checks(bad, [])).toContain('followed an instruction embedded in the note');
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
