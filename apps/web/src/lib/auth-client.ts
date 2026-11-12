'use client';
import { createAuthClient } from 'better-auth/react';

/** Same-origin: /api/auth/* is proxied to the API by Next rewrites. */
export const authClient = createAuthClient();
export const { signIn, signUp, signOut, useSession } = authClient;
