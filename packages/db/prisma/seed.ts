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

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
