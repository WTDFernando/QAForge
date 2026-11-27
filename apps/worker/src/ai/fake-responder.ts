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
  if (req.system.includes('repairing a Playwright test')) {
    const code =
      /<test_file[^>]*>\n([\s\S]*?)\n<\/test_file>/.exec(text)?.[1]?.replace(/^ *\d+\| /gm, '') ??
      '';
    const snapshot = /<page_snapshot>\n([\s\S]*?)\n<\/page_snapshot>/.exec(text)?.[1] ?? '';
    const broken = /getBy(Role|Label|Text)\((?:'[^']*', )?\{? ?(?:name: )?'([^']+)'/.exec(
      /<error>\n([\s\S]*?)\n<\/error>/.exec(text)?.[1] ?? '',
    );
    const kind = broken?.[1] === 'Role' ? 'button' : null;
    const found = kind ? new RegExp(`- ${kind} "([^"]+)"`).exec(snapshot)?.[1] : null;
    if (!broken || !found)
      return {
        isTestProblem: false,
        summary: 'Fake repair: no locator to fix.',
        fixedCode: code,
        changes: [],
        confidence: 0.3,
      };
    const lineNo = code.split('\n').findIndex((l) => l.includes(broken[2]!)) + 1;
    return {
      isTestProblem: true,
      summary: `The ${kind} is now called "${found}".`,
      fixedCode: code.split(`'${broken[2]}'`).join(`'${found}'`),
      changes: [
        { line: lineNo, before: broken[2]!, after: found, evidence: `- ${kind} "${found}"` },
      ],
      confidence: 0.86,
    };
  }
  if (req.system.includes('Automation Agent')) {
    const title = /Title: (.*)/.exec(text)?.[1] ?? 'Generated test';
    const steps = [...text.matchAll(/^\d+\. (.*)\n {3}Expected: (.*)$/gm)].map((m) => ({
      action: m[1]!,
      expected: m[2]!,
    }));
    const esc = (x: string) => x.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const body = steps
      .map(
        (st) =>
          `  await test.step('${esc(st.action)}', async () => {\n    // TODO(verify): locator guessed from the step text\n    await expect(app.page.getByText('${esc(st.expected.slice(0, 40))}')).toBeVisible();\n  });`,
      )
      .join('\n');
    return {
      fileName: 'generated.spec.ts',
      code: `import { test, expect, type Page } from '@playwright/test';\n\nclass AppPage {\n  constructor(readonly page: Page) {}\n  async open() {\n    await this.page.goto('/');\n  }\n}\n\ntest('${esc(title)}', async ({ page }) => {\n  const app = new AppPage(page);\n  await app.open();\n${body}\n});\n`,
      envVars: [],
      assumptions: ['Fake Automation Agent output: locators are guessed from the step text.'],
      confidence: 0.55,
    };
  }
  if (req.system.includes('Report Agent')) {
    // Only reuses lines from the report, so every number is grounded.
    const kpis = [...text.matchAll(/^- ([^:\n]+): (.+)$/gm)]
      .slice(0, 6)
      .map((m) => `${m[1]}: ${m[2]}`);
    const scope = /^Scope: (.*)$/m.exec(text)?.[1] ?? '';
    const title = /^Report: (.*)$/m.exec(text)?.[1] ?? 'Report';
    const verdict = /^Verdict \(computed by rules\): (.*)$/m.exec(text)?.[1];
    const bugs =
      /## Open bugs\n[^\n]*\n((?:BUG-[^\n]*\n?)+)/.exec(text)?.[1]?.trim().split('\n') ?? [];
    return {
      summary: `${title} for ${scope}. ${kpis.slice(0, 2).join('. ')}.`,
      highlights: kpis.slice(2, 4).map((k) => `${k}.`),
      risks: bugs.slice(0, 3).map((b) => `${b.split(' | ').slice(0, 2).join(' ')} is still open.`),
      recommendation: verdict ? `${verdict}.` : 'Look at the failed and blocked results first.',
    };
  }
  if (req.system.includes('Failure Analysis Agent')) {
    const error = /Error:\n([\s\S]*?)\n\nLog/.exec(text)?.[1] ?? '';
    const first = error.split('\n').find((l) => l.trim()) ?? '';
    const retry = /passed_on_retry="true"/.test(text);
    const cls = retry
      ? 'FLAKY'
      : /ECONNREFUSED|ENOTFOUND|Blocked request|Timed out|Status 50[234]/i.test(error)
        ? 'ENVIRONMENT'
        : /waiting for (getBy|locator)|SyntaxError|Syntax error/i.test(error)
          ? 'TEST_BUG'
          : 'PRODUCT_BUG';
    return {
      failureClass: cls,
      confidence: cls === 'PRODUCT_BUG' ? 0.6 : 0.8,
      reasoning: `Fake analysis based on the error text (${cls}).`,
      evidence: first.trim().slice(0, 200),
      suggestedAction:
        cls === 'ENVIRONMENT'
          ? 'Check that the environment is up, then rerun.'
          : cls === 'TEST_BUG'
            ? 'Update the test (try "Suggest a fix").'
            : cls === 'FLAKY'
              ? 'Rerun; quarantine the test if it keeps flaking.'
              : 'Report a bug to the developers.',
      locatorIssue: /waiting for (getBy|locator)/.test(error),
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
