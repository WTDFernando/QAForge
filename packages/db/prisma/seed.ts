/* Demo data: one org, two projects, users in several roles. Password for all: "qaforge-demo-1" */
import path from 'node:path';
import { PrismaClient, Role } from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';

// Load the monorepo root .env when DATABASE_URL isn't already set (e.g. plain `pnpm db:seed`).
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(path.resolve(__dirname, '../../../.env'));
  } catch {
    /* fall through: Prisma reports the missing variable */
  }
}

const prisma = new PrismaClient();
const PASSWORD = 'qaforge-demo-1';

const USERS: Array<{ name: string; email: string; role: Role }> = [
  { name: 'Olivia Owner', email: 'owner@qaforge.dev', role: 'OWNER' },
  { name: 'Lee Lead', email: 'lead@qaforge.dev', role: 'QA_LEAD' },
  { name: 'Ezra Engineer', email: 'qa@qaforge.dev', role: 'QA_ENGINEER' },
  { name: 'Dana Developer', email: 'dev@qaforge.dev', role: 'DEVELOPER' },
  { name: 'Casey Client', email: 'client@qaforge.dev', role: 'CLIENT' },
];

async function main() {
  const hash = await hashPassword(PASSWORD);
  const org = await prisma.organization.upsert({
    where: { slug: 'acme' },
    update: {},
    create: { name: 'Acme Corp', slug: 'acme' },
  });

  let ownerId = '';
  for (const u of USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { name: u.name, email: u.email, emailVerified: true },
    });
    if (u.role === 'OWNER') ownerId = user.id;
    const hasCred = await prisma.account.findFirst({
      where: { userId: user.id, providerId: 'credential' },
    });
    if (!hasCred) {
      await prisma.account.create({
        data: { userId: user.id, accountId: user.id, providerId: 'credential', password: hash },
      });
    }
    await prisma.membership.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
      update: { role: u.role },
      create: { organizationId: org.id, userId: user.id, role: u.role },
    });
  }

  for (const p of [
    { name: 'Payments', key: 'PAY', description: 'Checkout, refunds and payouts' },
    { name: 'Mobile App', key: 'MOB', description: 'iOS and Android customer app' },
  ]) {
    await prisma.project.upsert({
      where: { organizationId_key: { organizationId: org.id, key: p.key } },
      update: {},
      create: { ...p, organizationId: org.id, createdById: ownerId },
    });
  }
  await seedPaymentsContent(org.id, ownerId);
  await seedRunsAndBugs(org.id);
  await seedAutomation(org.id);
  await seedReleases(org.id);
  console.log(`Seeded org "${org.name}" with ${USERS.length} users. Password: ${PASSWORD}`);
}

/** Demo requirements, suites and test cases for the Payments project (only when it is empty). */
async function seedPaymentsContent(orgId: string, userId: string) {
  const project = await prisma.project.findUniqueOrThrow({
    where: { organizationId_key: { organizationId: orgId, key: 'PAY' } },
  });
  if ((await prisma.requirement.count({ where: { projectId: project.id } })) > 0) return;
  let reqSeq = 0;
  let tcSeq = 0;
  const who = { createdById: userId, updatedById: userId };
  const doc = (text: string) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

  const req = async (data: {
    title: string;
    type: 'EPIC' | 'FEATURE' | 'STORY';
    parentId?: string;
    priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    text?: string;
    ac?: string[];
    position: number;
  }) => {
    const r = await prisma.requirement.create({
      data: {
        projectId: project.id,
        seq: ++reqSeq,
        title: data.title,
        type: data.type,
        parentId: data.parentId,
        priority: data.priority ?? 'MEDIUM',
        position: data.position,
        description: data.text ? doc(data.text) : undefined,
        descriptionText: data.text ?? '',
        acceptanceCriteria: data.ac ?? [],
        status: 'APPROVED',
        ...who,
      },
    });
    await prisma.requirementVersion.create({
      data: {
        requirementId: r.id,
        version: 1,
        snapshot: { title: r.title, type: r.type },
        createdById: userId,
      },
    });
    return r;
  };

  const checkout = await req({
    title: 'Checkout',
    type: 'EPIC',
    position: 0,
    text: 'Everything between the cart and the order confirmation.',
  });
  const card = await req({
    title: 'Pay by card',
    type: 'FEATURE',
    parentId: checkout.id,
    position: 0,
  });
  const s1 = await req({
    title: 'Shopper pays with a new card',
    type: 'STORY',
    parentId: card.id,
    position: 0,
    priority: 'CRITICAL',
    text: 'As a shopper I can enter card details at checkout and pay.',
    ac: [
      'Valid Visa/Mastercard/Amex are accepted',
      'Order confirmation shows the last 4 digits',
      'Card data is never stored unencrypted',
    ],
  });
  const s2 = await req({
    title: 'Declined card shows a clear error',
    type: 'STORY',
    parentId: card.id,
    position: 1,
    priority: 'HIGH',
    ac: [
      'The bank decline reason is shown in plain language',
      'The shopper can retry with another card',
      'No order is created',
    ],
  });
  const s3 = await req({
    title: '3-D Secure challenge',
    type: 'STORY',
    parentId: card.id,
    position: 2,
    priority: 'HIGH',
    ac: ['Challenge opens in a modal', 'Cancelling the challenge returns to payment step'],
  });
  const wallet = await req({
    title: 'Pay with digital wallets',
    type: 'FEATURE',
    parentId: checkout.id,
    position: 1,
  });
  await req({
    title: 'Apple Pay on Safari',
    type: 'STORY',
    parentId: wallet.id,
    position: 0,
    priority: 'MEDIUM',
  });
  await req({
    title: 'Google Pay on Chrome',
    type: 'STORY',
    parentId: wallet.id,
    position: 1,
    priority: 'MEDIUM',
  });
  const refunds = await req({ title: 'Refunds', type: 'EPIC', position: 1 });
  const s4 = await req({
    title: 'Support agent issues a partial refund',
    type: 'STORY',
    parentId: refunds.id,
    position: 0,
    priority: 'HIGH',
    ac: ['Amount cannot exceed the captured amount', 'Shopper receives a refund email'],
  });

  const suite = async (name: string, position: number, parentId?: string) =>
    prisma.testSuite.create({
      data: { projectId: project.id, name, position, parentId, createdById: userId },
    });
  const sCheckout = await suite('Checkout', 0);
  const sCards = await suite('Card payments', 0, sCheckout.id);
  const sRefunds = await suite('Refunds', 1);
  const login = await prisma.sharedStep.create({
    data: {
      projectId: project.id,
      name: 'Log in as shopper',
      createdById: userId,
      steps: [
        {
          action: 'Open /login and sign in as shopper@demo.test',
          expected: 'Account home page is shown',
        },
        { action: 'Add any product to the cart', expected: 'Cart badge shows 1' },
      ],
    },
  });

  type Tc = {
    title: string;
    suiteId: string;
    reqs: string[];
    status: 'DRAFT' | 'IN_REVIEW' | 'APPROVED';
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    technique: 'POSITIVE' | 'NEGATIVE' | 'BOUNDARY';
    tags: string[];
    steps: [string, string][];
    ai?: number;
    data?: { columns: string[]; rows: string[][] };
  };
  const tcs: Tc[] = [
    {
      title: 'Pay with a valid Visa card',
      suiteId: sCards.id,
      reqs: [s1.id],
      status: 'APPROVED',
      priority: 'CRITICAL',
      technique: 'POSITIVE',
      tags: ['smoke', 'payments'],
      steps: [
        ['Go to checkout', 'Payment form is shown'],
        [
          'Enter card 4242 4242 4242 4242, any future expiry, CVC 123',
          'Fields validate without errors',
        ],
        ['Click Pay', 'Order confirmation shows "•••• 4242"'],
      ],
    },
    {
      title: 'Supported card brands are accepted',
      suiteId: sCards.id,
      reqs: [s1.id],
      status: 'APPROVED',
      priority: 'HIGH',
      technique: 'POSITIVE',
      tags: ['payments'],
      steps: [['Pay with the card from the data table', 'Payment succeeds']],
      data: {
        columns: ['brand', 'number'],
        rows: [
          ['Visa', '4242424242424242'],
          ['Mastercard', '5555555555554444'],
          ['Amex', '378282246310005'],
        ],
      },
    },
    {
      title: 'Declined card shows the decline reason',
      suiteId: sCards.id,
      reqs: [s2.id],
      status: 'IN_REVIEW',
      priority: 'HIGH',
      technique: 'NEGATIVE',
      tags: ['payments', 'regression'],
      steps: [
        ['Pay with card 4000 0000 0000 0002', 'Message "Your card was declined" is shown'],
        ['Check orders list', 'No new order exists'],
      ],
    },
    {
      title: 'Expiry date in the past is rejected',
      suiteId: sCards.id,
      reqs: [s1.id],
      status: 'DRAFT',
      priority: 'MEDIUM',
      technique: 'BOUNDARY',
      tags: ['validation'],
      ai: 0.86,
      steps: [
        ['Enter expiry 01/20', 'Field shows "Expiry date is in the past"'],
        ['Enter the current month', 'Field is valid'],
      ],
    },
    {
      title: 'Shopper can retry with another card after a decline',
      suiteId: sCards.id,
      reqs: [s2.id],
      status: 'DRAFT',
      priority: 'HIGH',
      technique: 'POSITIVE',
      tags: ['payments'],
      ai: 0.78,
      steps: [
        ['Pay with a declined card', 'Error shown, form stays filled except card number'],
        ['Enter a valid card and pay', 'Order confirmation shown'],
      ],
    },
    {
      title: 'Cancel 3-D Secure challenge returns to payment',
      suiteId: sCards.id,
      reqs: [s3.id],
      status: 'DRAFT',
      priority: 'HIGH',
      technique: 'NEGATIVE',
      tags: ['3ds'],
      steps: [
        ['Pay with 3DS test card 4000 0027 6000 3184', 'Challenge modal opens'],
        ['Click Cancel in the challenge', 'Payment step is shown with an error'],
      ],
    },
    {
      title: 'Partial refund cannot exceed captured amount',
      suiteId: sRefunds.id,
      reqs: [s4.id],
      status: 'APPROVED',
      priority: 'HIGH',
      technique: 'BOUNDARY',
      tags: ['refunds'],
      steps: [
        ['Open a captured order of $50 in the admin', 'Refund button is enabled'],
        ['Refund $50.01', 'Validation error "Exceeds captured amount"'],
        ['Refund $50.00', 'Refund succeeds'],
      ],
    },
  ];
  for (const t of tcs) {
    const tc = await prisma.testCase.create({
      data: {
        projectId: project.id,
        seq: ++tcSeq,
        title: t.title,
        suiteId: t.suiteId,
        status: t.status,
        priority: t.priority,
        technique: t.technique,
        tags: t.tags,
        testData: t.data,
        aiGenerated: t.ai !== undefined,
        aiConfidence: t.ai,
        preconditions: 'Shopper account exists; test payment gateway is enabled.',
        ...who,
        steps: {
          create: [
            { position: 0, sharedStepId: login.id },
            ...t.steps.map(([action, expected], i) => ({ position: i + 1, action, expected })),
          ],
        },
        requirements: {
          create: t.reqs.map((requirementId) => ({ requirementId, createdById: userId })),
        },
      },
    });
    await prisma.testCaseVersion.create({
      data: {
        testCaseId: tc.id,
        version: 1,
        snapshot: { title: tc.title, status: tc.status },
        createdById: userId,
      },
    });
  }
  await prisma.projectCounter.createMany({
    data: [
      { projectId: project.id, kind: 'requirement', value: reqSeq },
      { projectId: project.id, kind: 'testCase', value: tcSeq },
    ],
    skipDuplicates: true,
  });
  await prisma.environment.createMany({
    data: [
      {
        projectId: project.id,
        name: 'Dev',
        baseUrl: 'https://dev.shop.example',
        position: 0,
        createdById: userId,
      },
      {
        projectId: project.id,
        name: 'Staging',
        baseUrl: 'https://staging.shop.example',
        position: 1,
        createdById: userId,
      },
    ],
    skipDuplicates: true,
  });
}

/** Demo test runs (active, completed, planned) and bugs on the board for Payments. */
async function seedRunsAndBugs(orgId: string) {
  const project = await prisma.project.findUniqueOrThrow({
    where: { organizationId_key: { organizationId: orgId, key: 'PAY' } },
  });
  if ((await prisma.testRun.count({ where: { projectId: project.id } })) > 0) return;
  const users = Object.fromEntries(
    (await prisma.user.findMany({ where: { email: { in: USERS.map((u) => u.email) } } })).map(
      (u) => [u.email.split('@')[0], u.id],
    ),
  ) as Record<'owner' | 'lead' | 'qa' | 'dev' | 'client', string>;
  const staging = await prisma.environment.findFirst({
    where: { projectId: project.id, name: 'Staging' },
  });
  const cases = await prisma.testCase.findMany({
    where: { projectId: project.id, deletedAt: null },
    include: { steps: { orderBy: { position: 'asc' }, include: { sharedStep: true } } },
    orderBy: { seq: 'asc' },
  });
  const ref = (kind: string, n: number) => `${kind}-${String(n).padStart(4, '0')}`;
  const snapshotOf = (tc: (typeof cases)[number]) => ({
    ref: ref('TC', tc.seq),
    title: tc.title,
    preconditions: tc.preconditions,
    steps: tc.steps.flatMap((s) =>
      s.sharedStep
        ? (s.sharedStep.steps as { action: string; expected: string }[])
        : [{ action: s.action, expected: s.expected }],
    ),
    testData: tc.testData,
    priority: tc.priority,
    type: tc.type,
  });
  const day = 24 * 3600_000;
  const runs = [
    {
      seq: 1,
      name: 'Payments smoke · nightly',
      status: 'COMPLETED' as const,
      build: 'nightly-1115',
      pattern: ['PASSED', 'PASSED', 'PASSED', 'PASSED', 'PASSED', 'FAILED', 'PASSED', 'PASSED'],
      dueAt: new Date(Date.now() - 2 * day),
    },
    {
      seq: 2,
      name: 'Release 2.4 regression',
      status: 'IN_PROGRESS' as const,
      build: '2.4.0-rc1',
      pattern: [
        'PASSED',
        'PASSED',
        'FAILED',
        'UNTESTED',
        'BLOCKED',
        'PASSED',
        'RETEST',
        'SKIPPED',
        'UNTESTED',
        'PASSED',
      ],
      dueAt: new Date(Date.now() + 3 * day),
    },
    {
      seq: 3,
      name: 'Release 2.5 regression',
      status: 'PLANNED' as const,
      build: null,
      pattern: [],
      dueAt: new Date(Date.now() + 16 * day),
    },
  ];
  const resultIds: Record<string, string> = {};
  for (const r of runs) {
    const run = await prisma.testRun.create({
      data: {
        projectId: project.id,
        seq: r.seq,
        name: r.name,
        status: r.status,
        build: r.build,
        environmentId: staging?.id,
        dueAt: r.dueAt,
        startedAt: r.status === 'PLANNED' ? null : new Date(Date.now() - 3 * day),
        completedAt: r.status === 'COMPLETED' ? new Date(Date.now() - 2 * day) : null,
        createdById: users.lead,
        updatedById: users.lead,
      },
    });
    let position = 0;
    for (const tc of cases) {
      const snap = snapshotOf(tc);
      const rows = (tc.testData as { rows?: unknown[] } | null)?.rows?.length ?? 0;
      for (const dataRowIndex of rows ? [...Array(rows).keys()] : [null]) {
        const status = (r.pattern[position % Math.max(r.pattern.length, 1)] ?? 'UNTESTED') as
          'PASSED' | 'FAILED' | 'BLOCKED' | 'SKIPPED' | 'RETEST' | 'UNTESTED';
        const executed = !['UNTESTED', 'RETEST'].includes(status);
        const res = await prisma.testRunResult.create({
          data: {
            testRunId: run.id,
            testCaseId: tc.id,
            testCaseVersion: tc.version,
            position: position++,
            snapshot: snap,
            dataRowIndex,
            status,
            assigneeId: position % 3 === 0 ? users.lead : users.qa,
            executedById: executed ? users.qa : null,
            executedAt: executed ? new Date(Date.now() - day) : null,
            durationSec: executed ? 60 + ((position * 37) % 240) : null,
            stepResults:
              status === 'FAILED'
                ? snap.steps.map((_, index) => ({
                    index,
                    status: index === snap.steps.length - 1 ? 'FAILED' : 'PASSED',
                    actual:
                      index === snap.steps.length - 1
                        ? 'An error banner appeared instead of the expected result.'
                        : '',
                  }))
                : undefined,
          },
        });
        if (status === 'FAILED' && !resultIds[`${r.seq}`]) resultIds[`${r.seq}`] = res.id;
      }
    }
  }
  const bugs: {
    title: string;
    status: 'NEW' | 'TRIAGED' | 'IN_PROGRESS' | 'FIXED' | 'READY_FOR_RETEST' | 'CLOSED';
    severity: 'BLOCKER' | 'CRITICAL' | 'MAJOR' | 'MINOR' | 'TRIVIAL';
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    component: string;
    assignee?: keyof typeof users;
    ai?: number;
    fromRun?: string;
  }[] = [
    {
      title: 'Expired discount code is still applied at payment',
      status: 'NEW',
      severity: 'CRITICAL',
      priority: 'HIGH',
      component: 'Checkout',
      fromRun: '2',
    },
    {
      title: 'Pay button overlaps the order total on small screens',
      status: 'NEW',
      severity: 'MAJOR',
      priority: 'HIGH',
      component: 'Checkout',
      ai: 0.82,
    },
    {
      title: 'Typo in refund confirmation email subject',
      status: 'NEW',
      severity: 'TRIVIAL',
      priority: 'LOW',
      component: 'Emails',
    },
    {
      title: 'Saved card list loads slowly with 20+ cards',
      status: 'TRIAGED',
      severity: 'MAJOR',
      priority: 'MEDIUM',
      component: 'Accounts',
      assignee: 'dev',
    },
    {
      title: 'Address form accepts a 3-digit postcode',
      status: 'TRIAGED',
      severity: 'MINOR',
      priority: 'MEDIUM',
      component: 'Accounts',
      ai: 0.74,
    },
    {
      title: '3-D Secure popup closes on mobile Safari',
      status: 'IN_PROGRESS',
      severity: 'BLOCKER',
      priority: 'CRITICAL',
      component: 'Checkout',
      assignee: 'dev',
    },
    {
      title: 'Order history shows the wrong currency',
      status: 'IN_PROGRESS',
      severity: 'MAJOR',
      priority: 'HIGH',
      component: 'Accounts',
      assignee: 'dev',
    },
    {
      title: 'Discount line missing on PDF invoice',
      status: 'FIXED',
      severity: 'MINOR',
      priority: 'LOW',
      component: 'Billing',
      assignee: 'dev',
    },
    {
      title: 'Partial refund rounds to whole dollars',
      status: 'READY_FOR_RETEST',
      severity: 'CRITICAL',
      priority: 'HIGH',
      component: 'Refunds',
      assignee: 'qa',
      fromRun: '1',
    },
    {
      title: 'Session expires during a long checkout',
      status: 'CLOSED',
      severity: 'MAJOR',
      priority: 'MEDIUM',
      component: 'Checkout',
    },
  ];
  const rank: Record<string, number> = {};
  for (const [i, b] of bugs.entries()) {
    rank[b.status] = (rank[b.status] ?? 0) + 1024;
    const resultId = b.fromRun ? resultIds[b.fromRun] : undefined;
    const result = resultId
      ? await prisma.testRunResult.findUnique({ where: { id: resultId } })
      : null;
    const snap = result?.snapshot as { steps: { action: string; expected: string }[] } | undefined;
    const bug = await prisma.bug.create({
      data: {
        projectId: project.id,
        seq: i + 1,
        title: b.title,
        status: b.status,
        resolution: b.status === 'CLOSED' ? 'FIXED' : null,
        closedAt: b.status === 'CLOSED' ? new Date() : null,
        severity: b.severity,
        priority: b.priority,
        component: b.component,
        assigneeId: b.assignee ? users[b.assignee] : null,
        environmentId: staging?.id,
        envDetails: { browser: 'Chrome 141', os: 'Windows', build: '2.4.0-rc1' },
        stepsToReproduce: snap
          ? snap.steps.map((s) => s.action)
          : ['Sign in as a shopper', 'Open Checkout', 'Continue to the payment step'],
        expectedResult: snap?.steps.at(-1)?.expected ?? 'The page works as specified.',
        actualResult: 'An error banner appeared instead of the expected result.',
        testRunResultId: result?.id,
        failedStepIndex: snap ? snap.steps.length - 1 : null,
        rank: rank[b.status],
        aiGenerated: b.ai !== undefined,
        aiNotes:
          b.ai !== undefined
            ? {
                confidence: b.ai,
                rationale:
                  'Drafted from a screenshot and a one-line note; severity reflects a blocked purchase.',
                missingInfo: ['Which account was signed in?'],
                duplicates: [],
                model: 'fake-model',
              }
            : undefined,
        createdById: b.ai !== undefined ? users.qa : users.lead,
        updatedById: users.lead,
        testCases: result?.testCaseId
          ? { create: [{ testCaseId: result.testCaseId, createdById: users.lead }] }
          : undefined,
      },
    });
    if (i === 0) {
      await prisma.comment.create({
        data: {
          projectId: project.id,
          entityType: 'bug',
          entityId: bug.id,
          authorId: users.dev,
          body: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'The expiry check runs before the cart is re-priced. Looking at it today.',
                  },
                ],
              },
            ],
          },
          bodyText: 'The expiry check runs before the cart is re-priced. Looking at it today.',
        },
      });
    }
    if (b.assignee === 'qa' || b.assignee === 'dev') {
      await prisma.notification.create({
        data: {
          organizationId: orgId,
          projectId: project.id,
          userId: users[b.assignee],
          type: b.status === 'READY_FOR_RETEST' ? 'bug.ready_for_retest' : 'bug.assigned',
          title: `${ref('BUG', i + 1)} ${b.status === 'READY_FOR_RETEST' ? 'is ready for retest' : 'was assigned to you'}`,
          body: b.title,
          entityType: 'bug',
          entityId: bug.id,
          actorId: users.lead,
        },
      });
    }
  }
  await prisma.projectCounter.createMany({
    data: [
      { projectId: project.id, kind: 'testRun', value: runs.length },
      { projectId: project.id, kind: 'bug', value: bugs.length },
    ],
    skipDuplicates: true,
  });
}

/**
 * Phase 3 demo: an API collection that runs against the local QAForge API, Playwright tests
 * against the local web app, one finished run (with an AI analysis and a pending fix to review)
 * and a paused nightly schedule.
 */
async function seedAutomation(orgId: string) {
  const project = await prisma.project.findFirstOrThrow({
    where: { organizationId: orgId, key: 'PAY' },
  });
  if (await prisma.apiCollection.findFirst({ where: { projectId: project.id } })) return;
  const lead = await prisma.user.findUniqueOrThrow({ where: { email: 'lead@qaforge.dev' } });
  const qa = await prisma.user.findUniqueOrThrow({ where: { email: 'qa@qaforge.dev' } });

  // "Local" points at the web app started by `pnpm dev`, so the demo tests really run.
  await prisma.environment.createMany({
    data: [
      {
        projectId: project.id,
        name: 'Local',
        baseUrl: 'http://localhost:3000',
        position: 2,
        createdById: lead.id,
      },
    ],
    skipDuplicates: true,
  });
  const local = await prisma.environment.findFirstOrThrow({
    where: { projectId: project.id, name: 'Local' },
  });
  const tcPay = await prisma.testCase.findFirst({
    where: { projectId: project.id, title: { contains: 'new card' } },
  });

  const api = await prisma.apiCollection.create({
    data: {
      projectId: project.id,
      name: 'QAForge API',
      description: 'Smoke checks against the API started by pnpm dev.',
      variables: { api: 'http://localhost:4000' },
      auth: { type: 'none' },
      createdById: lead.id,
    },
  });
  const health = await prisma.apiRequest.create({
    data: {
      collectionId: api.id,
      name: 'Health check',
      method: 'GET',
      url: '{{api}}/health',
      headers: [{ name: 'accept', value: 'application/json', enabled: true }],
      query: [],
      body: { type: 'none' },
      assertions: [
        { type: 'status', op: 'eq', value: '200' },
        { type: 'jsonPath', path: '$.status', op: 'eq', value: 'ok' },
        { type: 'jsonPath', path: '$.db', op: 'eq', value: 'up' },
        { type: 'responseTime', lessThanMs: 2000 },
      ],
      extract: [{ variable: 'dbStatus', from: 'jsonPath', path: '$.db' }],
      position: 0,
      createdById: lead.id,
      updatedById: lead.id,
    },
  });
  const unauth = await prisma.apiRequest.create({
    data: {
      collectionId: api.id,
      name: 'Projects need a session',
      method: 'GET',
      url: '{{api}}/v1/me',
      headers: [],
      query: [],
      body: { type: 'none' },
      assertions: [
        { type: 'status', op: 'eq', value: '401' },
        { type: 'header', name: 'content-type', op: 'contains', value: 'json' },
      ],
      extract: [],
      position: 1,
      createdById: lead.id,
      updatedById: lead.id,
    },
  });
  const folder = await prisma.apiCollection.create({
    data: {
      projectId: project.id,
      parentId: api.id,
      name: 'OpenAPI',
      variables: {},
      auth: { type: 'inherit' },
      position: 0,
      createdById: lead.id,
    },
  });
  await prisma.apiRequest.create({
    data: {
      collectionId: folder.id,
      name: 'OpenAPI document',
      method: 'GET',
      url: '{{api}}/openapi.json',
      headers: [],
      query: [],
      body: { type: 'none' },
      assertions: [
        { type: 'status', op: 'eq', value: '200' },
        { type: 'jsonPath', path: '$.openapi', op: 'matches', value: '^3\\.' },
      ],
      extract: [],
      position: 0,
      createdById: lead.id,
      updatedById: lead.id,
    },
  });

  const loginCode = `import { test, expect } from '@playwright/test';

test('sign-in page shows the form', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
});

test('wrong password shows an error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@qaforge.dev');
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
});
`;
  const payOld = `import { test, expect } from '@playwright/test';

test('shopper pays with a new card', async ({ page }) => {
  await page.goto('/checkout');
  await page.getByLabel('Email').fill('guest@example.com');
  await page.getByLabel('Card number').fill(process.env.TEST_CARD ?? '4242424242424242');
  await page.getByRole('button', { name: 'Pay now' }).click();
  await expect(page.getByText('Order confirmed')).toBeVisible();
});
`;
  const payFix = payOld.replace("{ name: 'Pay now' }", "{ name: 'Place order' }");
  const draftCode = `import { test, expect, type Page } from '@playwright/test';

class CheckoutPage {
  constructor(private readonly page: Page) {}
  async open() {
    await this.page.goto('/checkout');
  }
  async payWith(card: string) {
    await this.page.getByLabel('Card number').fill(card);
    await this.page.getByRole('button', { name: 'Place order' }).click();
  }
  declineMessage() {
    return this.page.getByRole('alert');
  }
}

test('declined card shows a clear error', async ({ page }) => {
  const checkout = new CheckoutPage(page);
  await checkout.open();
  await checkout.payWith(process.env.DECLINED_CARD ?? '4000000000000002');
  await expect(checkout.declineMessage()).toContainText('declined');
});
`;
  const mk = async (data: {
    name: string;
    path: string;
    code: string;
    status: 'ACTIVE' | 'QUARANTINED' | 'DISABLED';
    tags: string[];
    testCaseId?: string | null;
    flakyScore?: number;
    aiGenerated?: boolean;
    version?: number;
  }) => {
    const t = await prisma.automationTest.create({
      data: {
        projectId: project.id,
        ...data,
        version: data.version ?? 1,
        createdById: qa.id,
        updatedById: qa.id,
      },
    });
    await prisma.automationTestVersion.create({
      data: {
        automationTestId: t.id,
        version: t.version,
        code: t.code,
        reason: data.aiGenerated ? 'ai_generate' : 'edit',
        createdById: qa.id,
      },
    });
    return t;
  };
  const login = await mk({
    name: 'Sign-in page',
    path: 'auth/sign-in.spec.ts',
    code: loginCode,
    status: 'ACTIVE',
    tags: ['smoke'],
  });
  const pay = await mk({
    name: 'Shopper pays with a new card',
    path: 'checkout/new-card.spec.ts',
    code: payOld,
    status: 'ACTIVE',
    tags: ['checkout', 'regression'],
    testCaseId: tcPay?.id ?? null,
    flakyScore: 0.1,
  });
  await mk({
    name: 'Declined card shows a clear error',
    path: 'generated/declined-card.spec.ts',
    code: draftCode,
    status: 'DISABLED',
    tags: ['ai-draft', 'checkout'],
    aiGenerated: true,
  });

  // One finished run: API checks pass, sign-in passes after a retry, checkout fails.
  const started = new Date(Date.now() - 2 * 3600_000);
  const run = await prisma.automationRun.create({
    data: {
      projectId: project.id,
      seq: 1,
      trigger: 'MANUAL',
      triggerRef: qa.id,
      selection: { kind: 'all' },
      environmentId: local.id,
      build: '2.14.0',
      status: 'FAILED',
      retries: 1,
      totals: {
        total: 4,
        passed: 3,
        failed: 1,
        flaky: 1,
        skipped: 0,
        quarantined: 0,
        durationMs: 48_200,
      },
      createdById: qa.id,
      createdAt: started,
      startedAt: started,
      finishedAt: new Date(started.getTime() + 48_200),
    },
  });
  const res = (
    data: Omit<Parameters<typeof prisma.automationResult.create>[0]['data'], 'automationRunId'>,
  ) =>
    prisma.automationResult.create({
      data: { automationRunId: run.id, createdAt: started, ...data } as never,
    });
  await res({
    apiRequestId: health.id,
    name: 'Health check',
    status: 'PASSED',
    durationMs: 38,
    position: 0,
    exchange: {
      request: {
        method: 'GET',
        url: 'http://localhost:4000/health',
        headers: { accept: 'application/json' },
        body: null,
      },
      response: {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: '{"status":"ok","db":"up","redis":"up"}',
        size: 38,
        truncated: false,
      },
      assertions: [
        {
          assertion: { type: 'status', op: 'eq', value: '200' },
          passed: true,
          actual: '200',
          message: '',
        },
        {
          assertion: { type: 'jsonPath', path: '$.status', op: 'eq', value: 'ok' },
          passed: true,
          actual: 'ok',
          message: '',
        },
      ],
    },
  });
  await res({
    apiRequestId: unauth.id,
    name: 'Projects need a session',
    status: 'PASSED',
    durationMs: 21,
    position: 1,
  });
  await res({
    automationTestId: login.id,
    name: 'auth/sign-in.spec.ts',
    status: 'PASSED',
    flaky: true,
    attempts: 2,
    durationMs: 9_400,
    position: 2,
    exchange: {
      driver: 'docker',
      cases: [
        { title: 'sign-in page shows the form', status: 'expected', durationMs: 2100, error: null },
        { title: 'wrong password shows an error', status: 'flaky', durationMs: 7300, error: null },
      ],
    },
  });
  await res({
    automationTestId: pay.id,
    name: 'checkout/new-card.spec.ts',
    status: 'FAILED',
    attempts: 2,
    durationMs: 31_900,
    position: 3,
    error:
      "Error: locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Pay now' })",
    log: 'Running 1 test using 1 worker\n  ✘ checkout/new-card.spec.ts:3 shopper pays with a new card (31.9s)\n  retry #1 ✘',
    exchange: {
      driver: 'docker',
      cases: [
        {
          title: 'shopper pays with a new card',
          status: 'unexpected',
          durationMs: 31_900,
          error: 'Timeout',
        },
      ],
    },
    failureClass: 'TEST_BUG',
    analysis: {
      confidence: 0.86,
      reasoning:
        'The page loaded and the card field was filled, but no button named "Pay now" exists. The snapshot shows a "Place order" button in the same place, so the label changed in the app, not the behaviour.',
      evidence:
        "page snapshot: button \"Place order\" [ref=e41]\nerror: waiting for getByRole('button', { name: 'Pay now' })",
      suggestedAction: 'Update the locator to the new label; no product bug needed.',
      locatorIssue: true,
    },
  });
  await prisma.automationTest.update({
    where: { id: pay.id },
    data: {
      pendingFix: {
        jobId: '00000000-0000-4000-8000-000000000000',
        code: payFix,
        summary:
          'The "Pay now" button was renamed to "Place order" (seen in the failure snapshot).',
        changes: [
          "getByRole('button', { name: 'Pay now' }) → getByRole('button', { name: 'Place order' })",
        ],
        confidence: 0.86,
        baseVersion: 1,
      },
    },
  });
  await prisma.automationSchedule.create({
    data: {
      projectId: project.id,
      name: 'Weekday smoke',
      cron: '0 6 * * 1-5',
      timezone: 'UTC',
      selection: { kind: 'tags', tags: ['smoke'] },
      environmentId: local.id,
      // Paused so a fresh install doesn't start runs on its own.
      enabled: false,
      createdById: lead.id,
    },
  });
  await prisma.projectCounter.createMany({
    data: [{ projectId: project.id, kind: 'automationRun', value: 1 }],
    skipDuplicates: true,
  });
}

/**
 * Phase 4 demo: a release being tested (blocked by an open critical bug, two approvers named),
 * an older shipped release, and a paused weekly email of the bug summary.
 */
async function seedReleases(orgId: string) {
  const project = await prisma.project.findFirstOrThrow({
    where: { organizationId: orgId, key: 'PAY' },
  });
  if (await prisma.release.findFirst({ where: { projectId: project.id } })) return;
  const lead = await prisma.user.findUniqueOrThrow({ where: { email: 'lead@qaforge.dev' } });
  const client = await prisma.user.findUniqueOrThrow({ where: { email: 'client@qaforge.dev' } });
  const who = { projectId: project.id, createdById: lead.id, updatedById: lead.id };
  const stories = await prisma.requirement.findMany({
    where: { projectId: project.id, deletedAt: null, type: 'STORY' },
    orderBy: { seq: 'asc' },
    take: 6,
  });
  const run = await prisma.testRun.findFirst({
    where: { projectId: project.id, name: 'Release 2.4 regression' },
  });
  const nightly = await prisma.testRun.findFirst({
    where: { projectId: project.id, name: 'Payments smoke · nightly' },
  });
  const gate = (
    metric: string,
    operator: string,
    threshold: number,
    position: number,
    blocking = true,
    params = {},
  ) => ({
    metric: metric as never,
    operator: operator as never,
    threshold,
    params,
    blocking,
    position,
  });
  const spring = await prisma.release.create({
    data: {
      ...who,
      seq: 1,
      name: 'Spring release',
      version: '2.4.0',
      description: 'Card payments with 3-D Secure, digital wallets and partial refunds.',
      targetDate: new Date(Date.now() + 18 * 86_400_000),
      items: { create: stories.map((r) => ({ requirementId: r.id, createdById: lead.id })) },
      gates: {
        create: [
          gate('EXECUTION_COMPLETE', 'GTE', 100, 0),
          gate('PASS_RATE', 'GTE', 95, 1),
          gate('OPEN_BUGS', 'LTE', 0, 2, true, { severities: ['BLOCKER', 'CRITICAL'] }),
          gate('REQUIREMENT_COVERAGE', 'GTE', 90, 3, false),
        ],
      },
      approvals: {
        create: [
          { approverId: lead.id, roleLabel: 'QA Lead' },
          { approverId: client.id, roleLabel: 'Client' },
        ],
      },
    },
  });
  if (run) await prisma.testRun.update({ where: { id: run.id }, data: { releaseId: spring.id } });

  const winter = await prisma.release.create({
    data: {
      ...who,
      seq: 2,
      name: 'Winter release',
      version: '2.3.0',
      description: 'Saved cards and receipts.',
      status: 'RELEASED',
      targetDate: new Date(Date.now() - 20 * 86_400_000),
      requestedAt: new Date(Date.now() - 23 * 86_400_000),
      releasedAt: new Date(Date.now() - 21 * 86_400_000),
      gates: { create: [gate('PASS_RATE', 'GTE', 95, 0)] },
      approvals: {
        create: [
          {
            approverId: lead.id,
            roleLabel: 'QA Lead',
            status: 'APPROVED',
            comment: 'All regression passed.',
            decidedAt: new Date(Date.now() - 22 * 86_400_000),
          },
        ],
      },
    },
  });
  if (nightly)
    await prisma.testRun.update({ where: { id: nightly.id }, data: { releaseId: winter.id } });

  await prisma.reportSchedule.create({
    data: {
      projectId: project.id,
      name: 'Weekly bug summary',
      type: 'BUG_SUMMARY',
      cron: '0 8 * * 1',
      timezone: 'UTC',
      formats: ['pdf', 'xlsx'],
      recipients: ['product.owner@example.com'],
      // Paused so a fresh install doesn't send email on its own.
      enabled: false,
      createdById: lead.id,
    },
  });
  await prisma.projectCounter.createMany({
    data: [{ projectId: project.id, kind: 'release', value: 2 }],
    skipDuplicates: true,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
