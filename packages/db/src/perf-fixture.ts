import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Performance fixture (NFR: a 10,000 test case list loads in under 1 s).
 * Deterministic, bulk-inserted: 20 suites, `count` cases with 3 steps each, and a requirement
 * link on every 5th case. Used by `pnpm db:perf-fixture` and the API perf test.
 */
export async function createPerfFixture(
  prisma: PrismaClient,
  opts: { organizationId: string; userId: string; key?: string; count?: number },
) {
  const count = opts.count ?? 10_000;
  const key = opts.key ?? 'PERF';
  const existing = await prisma.project.findUnique({
    where: { organizationId_key: { organizationId: opts.organizationId, key } },
  });
  if (existing) return { projectId: existing.id, created: false };
  const project = await prisma.project.create({
    data: {
      organizationId: opts.organizationId,
      name: `Performance (${count.toLocaleString('en')} cases)`,
      key,
      description: 'Generated fixture for list performance checks.',
      createdById: opts.userId,
    },
  });
  const who = { createdById: opts.userId };
  const suites = Array.from({ length: 20 }, (_, i) => ({
    id: randomUUID(),
    projectId: project.id,
    name: `Area ${String(i + 1).padStart(2, '0')}`,
    position: i,
    ...who,
  }));
  await prisma.testSuite.createMany({ data: suites });
  const reqs = Array.from({ length: 200 }, (_, i) => ({
    id: randomUUID(),
    projectId: project.id,
    seq: i + 1,
    title: `Requirement ${i + 1}`,
    type: 'STORY' as const,
    position: i,
    ...who,
    updatedById: opts.userId,
  }));
  await prisma.requirement.createMany({ data: reqs });

  const STATUSES = [
    'DRAFT',
    'IN_REVIEW',
    'APPROVED',
    'APPROVED',
    'APPROVED',
    'DEPRECATED',
  ] as const;
  const PRIORITIES = ['LOW', 'MEDIUM', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
  const TYPES = ['FUNCTIONAL', 'FUNCTIONAL', 'REGRESSION', 'SMOKE', 'UI'] as const;
  const VERBS = ['Checkout', 'Refund', 'Sign in', 'Search', 'Export', 'Invite', 'Pay', 'Filter'];
  const NOUNS = [
    'with saved card',
    'as guest',
    'on mobile',
    'with discount',
    'after timeout',
    'in bulk',
  ];
  const CHUNK = 2000;
  for (let start = 0; start < count; start += CHUNK) {
    const n = Math.min(CHUNK, count - start);
    const cases = Array.from({ length: n }, (_, j) => {
      const i = start + j;
      return {
        id: randomUUID(),
        projectId: project.id,
        seq: i + 1,
        suiteId: suites[i % suites.length]!.id,
        title: `${VERBS[i % VERBS.length]} ${NOUNS[(i * 7) % NOUNS.length]} #${i + 1}`,
        status: STATUSES[i % STATUSES.length]!,
        priority: PRIORITIES[(i * 3) % PRIORITIES.length]!,
        type: TYPES[(i * 11) % TYPES.length]!,
        tags: i % 4 === 0 ? ['regression', `area-${i % 20}`] : [`area-${i % 20}`],
        aiGenerated: i % 9 === 0,
        ...who,
        updatedById: opts.userId,
        // Spread updatedAt so "recently updated" sorts are realistic.
        updatedAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000),
      };
    });
    await prisma.testCase.createMany({ data: cases });
    await prisma.testStep.createMany({
      data: cases.flatMap((c) =>
        [0, 1, 2].map((position) => ({
          testCaseId: c.id,
          position,
          action: `Step ${position + 1} of ${c.title}`,
          expected: 'Works as specified',
        })),
      ),
    });
    await prisma.requirementTestCase.createMany({
      data: cases
        .filter((_, j) => (start + j) % 5 === 0)
        .map((c, j) => ({ requirementId: reqs[j % reqs.length]!.id, testCaseId: c.id, ...who })),
    });
  }
  await prisma.projectCounter.createMany({
    data: [
      { projectId: project.id, kind: 'testCase', value: count },
      { projectId: project.id, kind: 'requirement', value: reqs.length },
    ],
  });
  return { projectId: project.id, created: true };
}
