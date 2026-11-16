import type { StructuredRequest } from '@qaforge/ai';
import type { z } from 'zod';

/**
 * Deterministic stand-in for the model (QAFORGE_AI_PROVIDER=fake): used by E2E tests and keyless
 * demos. Builds plausible output purely from the request text; never claims to be a real model.
 */
export function fakeResponder(req: StructuredRequest<z.ZodType>): unknown {
  const text = req.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n');
  if (req.system.includes('Requirement Agent')) {
    const doc = /<document[^>]*>\n([\s\S]*?)\n<\/document>/.exec(text)?.[1] ?? '';
    const lines = doc
      .split('\n')
      .map((l) => l.replace(/^[#*\-\d.\s]+/, '').trim())
      .filter((l) => l.length > 15)
      .slice(0, 6);
    const analyze = text.startsWith('Mode: analyze');
    const items = (
      lines.length ? lines : ['The system behaves as described in the document.']
    ).slice(0, analyze ? 1 : 6);
    return {
      summary: `Fake analysis: ${items.length} item(s).`,
      requirements: items.map((l, i) => ({
        key: `R${i + 1}`,
        parentKey: null,
        type: 'STORY',
        title: l.slice(0, 120),
        description: l,
        acceptanceCriteria: [`${l.slice(0, 80)} works as stated`],
        priority: 'MEDIUM',
        clarityScore: 55 + ((l.length * 7) % 40),
        ambiguities: [`"${l.split(' ').slice(0, 3).join(' ')}" could mean several things`],
        missingCriteria: ['Error behaviour is not specified'],
        questions: ['What should happen when the input is invalid?'],
        sourceQuote: l.slice(0, 120),
      })),
      documentQuestions: ['Which user roles does this apply to?'],
    };
  }
  if (req.system.includes('Test Case Writer')) {
    const reqs = [
      ...text.matchAll(
        /<requirement ref="([^"]+)"[^>]*>\nTitle: (.*)\n[\s\S]*?Acceptance criteria:\n([\s\S]*?)\nExisting/g,
      ),
    ];
    return {
      testCases: reqs.flatMap(([, ref, title, ac]) => {
        const criteria = ac!.split('\n').filter((l) => /^AC\d+:/.test(l));
        const positive = {
          requirementRefs: [ref],
          coversCriteria: criteria.map((c) => c.split(':')[0]),
          title: `${title} – happy path`,
          preconditions: 'User is signed in.',
          steps: [
            {
              action: `Perform: ${title}`,
              expected: criteria[0]?.replace(/^AC\d+:\s*/, '') || 'The action succeeds',
            },
            { action: 'Refresh the page', expected: 'The result is still shown' },
          ],
          testData: null,
          priority: 'HIGH',
          type: 'FUNCTIONAL',
          technique: 'POSITIVE',
          tags: ['ai'],
          confidence: 0.82,
          rationale: 'Covers the main success scenario.',
        };
        const negative = {
          ...positive,
          coversCriteria: [],
          title: `${title} – invalid input is rejected`,
          technique: 'NEGATIVE',
          confidence: 0.64,
          rationale: 'Assumes invalid input shows an error; the requirement does not say which.',
          steps: [
            {
              action: 'Submit with invalid input',
              expected: 'A validation error is shown and nothing is saved',
            },
          ],
        };
        return [positive, negative];
      }),
      skipped: [],
      coverageNotes: 'Fake writer output.',
    };
  }
  if (req.system.includes('Bug Agent')) {
    const note = /<note>\n([\s\S]*?)\n<\/note>/.exec(text)?.[1]?.trim() ?? 'Something went wrong';
    const url = /Page URL: (.*)/.exec(text)?.[1];
    const hasImage = req.content.some((p) => p.type === 'image');
    const first = note.split(/[.!?\n]/)[0]!.trim();
    return {
      title: first.charAt(0).toUpperCase() + first.slice(1, 120),
      summary: `Fake draft from the note: ${note.slice(0, 200)}`,
      stepsToReproduce: [
        url && url !== '(not given)' ? `Open ${url}` : '[Open the affected page]',
        '[Perform the action described in the note]',
      ],
      expectedResult: '[Expected behaviour not stated]',
      actualResult: note,
      severity: /crash|error|500|lost|cannot|can't/i.test(note) ? 'CRITICAL' : 'MAJOR',
      priority: 'HIGH',
      component: null,
      environment: { browser: null, os: null, device: null, viewport: null },
      highlight: hasImage ? { x: 0.25, y: 0.3, w: 0.5, h: 0.2, label: 'Problem area' } : null,
      missingInfo: ['Which account or data was used?'],
      confidence: hasImage ? 0.7 : 0.45,
      rationale: 'Fake Bug Agent output based only on the note.',
    };
  }
  // Reviewer
  return {
    verdict: 'needs_changes',
    score: 72,
    summary: 'Fake review: one step needs a more specific expected result.',
    issues: [
      {
        severity: 'medium',
        kind: 'vague_step',
        stepNumber: 1,
        message: 'Expected result is not specific.',
        suggestion: 'State the exact message or state the tester should see.',
      },
    ],
    missingCoverage: [],
    suggestedSteps: null,
  };
}
