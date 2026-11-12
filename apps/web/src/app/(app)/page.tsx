'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useMe } from '@/hooks/queries';
import { LAST_ORG_KEY } from '@/components/shell/app-shell';

/** Entry point: send the user to their last organization, or to onboarding. */
export default function HomeRedirect() {
  const router = useRouter();
  const { data } = useMe();
  useEffect(() => {
    if (!data) return;
    if (data.organizations.length === 0) return router.replace('/onboarding');
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_ORG_KEY);
    } catch {}
    const target = data.organizations.find((o) => o.slug === last) ?? data.organizations[0]!;
    router.replace(`/${target.slug}`);
  }, [data, router]);
  return (
    <div className="m-auto flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Loading your workspace…
    </div>
  );
}
