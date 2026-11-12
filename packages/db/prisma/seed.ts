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
  console.log(`Seeded org "${org.name}" with ${USERS.length} users. Password: ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
