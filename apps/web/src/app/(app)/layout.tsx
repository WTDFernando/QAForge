import { Suspense } from 'react';
import { AppShell } from '@/components/shell/app-shell';

/** Static skeleton is prerendered and served instantly; the URL-aware shell streams in. */
function ShellSkeleton() {
  return (
    <div className="flex h-screen">
      <div className="hidden w-60 border-r bg-sidebar md:block" />
      <div className="flex-1">
        <div className="h-12 border-b" />
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
