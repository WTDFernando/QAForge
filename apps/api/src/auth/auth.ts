import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { getPrisma } from '@qaforge/db';
import { env } from '../config/env';

function socialProviders() {
  const e = env();
  const providers: Record<string, { clientId: string; clientSecret: string }> = {};
  if (e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET) {
    providers.google = { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET };
  }
  if (e.MICROSOFT_CLIENT_ID && e.MICROSOFT_CLIENT_SECRET) {
    providers.microsoft = {
      clientId: e.MICROSOFT_CLIENT_ID,
      clientSecret: e.MICROSOFT_CLIENT_SECRET,
    };
  }
  return providers;
}

export function createAuth() {
  const e = env();
  return betterAuth({
    baseURL: e.AUTH_BASE_URL ?? e.WEB_URL,
    basePath: '/api/auth',
    secret: e.BETTER_AUTH_SECRET,
    trustedOrigins: [e.WEB_URL],
    database: prismaAdapter(getPrisma(), { provider: 'postgresql' }),
    emailAndPassword: { enabled: true, minPasswordLength: 10 },
    socialProviders: socialProviders(),
    session: {
      additionalFields: {
        activeOrganizationId: { type: 'string', required: false, input: false },
      },
    },
    advanced: { database: { generateId: 'uuid' } },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export const AUTH = Symbol('AUTH');
