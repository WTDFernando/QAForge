import { Suspense } from 'react';

/** Shared links render outside the app shell; the token is read from the URL on the client. */
export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="min-h-dvh bg-background" />}>{children}</Suspense>;
}
