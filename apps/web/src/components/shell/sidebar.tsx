'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FolderKanban, History, Plus, Settings, Users } from 'lucide-react';
import { Tooltip } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { Kbd } from '@/components/ui/kbd';
import { useCurrentOrg, useProjects } from '@/hooks/queries';
import { useCan } from '@/hooks/use-permission';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/logo';
import { OrgSwitcher } from './org-switcher';
import { useUiState } from './ui-state';

function NavLink({
  href,
  icon: Icon,
  children,
  exact = false,
}: {
  href: string;
  icon: React.ElementType;
  children: React.ReactNode;
  exact?: boolean;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        active && 'bg-accent font-medium text-foreground',
      )}
    >
      <Icon className="size-4" />
      <span className="truncate">{children}</span>
    </Link>
  );
}

export function Sidebar() {
  const { org } = useCurrentOrg();
  const projects = useProjects(org?.id);
  const canCreate = useCan('project:create');
  const canAudit = useCan('audit:read');
  const { setCreateProjectOpen } = useUiState();
  const base = org ? `/${org.slug}` : '';

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
      <div className="flex h-12 items-center px-4">
        <Logo />
      </div>
      <div className="px-2">
        <OrgSwitcher />
      </div>
      <nav className="mt-4 grid gap-0.5 px-2" aria-label="Organization">
        <NavLink href={base} icon={FolderKanban} exact>
          Projects
        </NavLink>
        <NavLink href={`${base}/settings/members`} icon={Users}>
          Members
        </NavLink>
        {canAudit && (
          <NavLink href={`${base}/settings/audit`} icon={History}>
            Audit log
          </NavLink>
        )}
        <NavLink href={`${base}/settings`} icon={Settings} exact>
          Settings
        </NavLink>
      </nav>
      <div className="mt-6 flex items-center justify-between px-4">
        <span className="text-xs font-medium text-muted-foreground">Projects</span>
        {canCreate && (
          <Tooltip
            content={
              <span>
                New project{' '}
                <Kbd className="ml-1 border-background/30 bg-transparent text-background">C</Kbd>
              </span>
            }
          >
            <button
              onClick={() => setCreateProjectOpen(true)}
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="New project"
            >
              <Plus className="size-4" />
            </button>
          </Tooltip>
        )}
      </div>
      <nav className="mt-1 grid gap-0.5 overflow-y-auto px-2 pb-4" aria-label="Projects">
        {projects.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="mx-2 my-1 h-5" />)}
        {projects.data?.map((p) => (
          <NavLink
            key={p.id}
            href={`${base}/p/${p.key}`}
            icon={() => (
              <span className="flex size-4 items-center justify-center rounded bg-primary/15 text-[9px] font-bold text-primary">
                {p.key[0]}
              </span>
            )}
          >
            {p.name}
          </NavLink>
        ))}
        {projects.data?.length === 0 && (
          <p className="px-2 py-1 text-xs text-muted-foreground">No projects yet</p>
        )}
      </nav>
    </aside>
  );
}
