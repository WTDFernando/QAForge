'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useCurrentOrg } from '@/hooks/queries';
import { useCan } from '@/hooks/use-permission';

export function SettingsNav() {
  const { org } = useCurrentOrg();
  const pathname = usePathname();
  const canAudit = useCan('audit:read');
  if (!org) return null;
  const tabs = [
    { href: `/${org.slug}/settings`, label: 'General' },
    { href: `/${org.slug}/settings/members`, label: 'Members' },
    { href: `/${org.slug}/settings/ai`, label: 'AI' },
    ...(canAudit ? [{ href: `/${org.slug}/settings/audit`, label: 'Audit log' }] : []),
  ];
  return (
    <nav className="flex gap-1 border-b px-6 lg:px-8" aria-label="Settings">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={pathname === t.href ? 'page' : undefined}
          className={cn(
            '-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground',
            pathname === t.href && 'border-primary font-medium text-foreground',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
