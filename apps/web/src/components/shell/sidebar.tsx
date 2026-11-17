'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Accessibility,
  BarChart3,
  Bot,
  Bug,
  ClipboardCheck,
  FileText,
  FolderKanban,
  Gauge,
  History,
  LayoutDashboard,
  PlayCircle,
  Rocket,
  ScanEye,
  Settings,
  Settings2,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { moduleEnabled, PROJECT_MODULES, type ProjectModuleKey } from '@qaforge/shared';
import { Badge } from '@/components/ui/badge';
import { useCurrentOrg, useCurrentProject } from '@/hooks/queries';
import { useCan } from '@/hooks/use-permission';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/logo';
import { OrgSwitcher } from './org-switcher';
import { ProjectSwitcher } from './project-switcher';

const MODULE_NAV: Record<
  ProjectModuleKey,
  { icon: React.ElementType; path: string; phase?: number }
> = {
  requirements: { icon: FileText, path: 'requirements' },
  testCases: { icon: ClipboardCheck, path: 'test-cases' },
  testRuns: { icon: PlayCircle, path: 'runs', phase: 4 },
  bugs: { icon: Bug, path: 'bugs', phase: 4 },
  automation: { icon: Bot, path: 'automation', phase: 3 },
  releases: { icon: Rocket, path: 'releases', phase: 4 },
  reports: { icon: BarChart3, path: 'reports', phase: 4 },
  performance: { icon: Gauge, path: 'performance' },
  security: { icon: ShieldCheck, path: 'security' },
  accessibility: { icon: Accessibility, path: 'accessibility' },
  visualMobile: { icon: ScanEye, path: 'visual' },
};

function NavLink({
  href,
  icon: Icon,
  children,
  exact = false,
  disabled,
  badge,
}: {
  href: string;
  icon: React.ElementType;
  children: React.ReactNode;
  exact?: boolean;
  disabled?: boolean;
  badge?: string;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const cls = cn(
    'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors',
    disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent hover:text-foreground',
    active && 'bg-accent font-medium text-foreground',
  );
  const content = (
    <>
      <Icon className="size-4" aria-hidden />
      <span className="flex-1 truncate">{children}</span>
      {badge && (
        <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
          {badge}
        </Badge>
      )}
    </>
  );
  if (disabled)
    return (
      <span className={cls} aria-disabled="true">
        {content}
      </span>
    );
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className={cls}>
      {content}
    </Link>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="px-4 pb-1 text-xs font-medium text-muted-foreground">{label}</div>
      <nav className="grid gap-0.5 px-2" aria-label={label}>
        {children}
      </nav>
    </div>
  );
}

export function SidebarContent() {
  const { org } = useCurrentOrg();
  const { project } = useCurrentProject();
  const canAudit = useCan('audit:read');
  const canEditProject = useCan('project:update');
  const orgBase = org ? `/${org.slug}` : '';
  const pBase = project ? `${orgBase}/p/${project.key}` : '';
  const core = PROJECT_MODULES.filter((m) => !('future' in m));
  const labs = PROJECT_MODULES.filter(
    (m) => 'future' in m && moduleEnabled(project?.settings, m.key),
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center px-4">
        <Logo />
      </div>
      <div className="px-2">
        <ProjectSwitcher />
      </div>
      <div className="flex-1 overflow-y-auto pb-4">
        {project && (
          <>
            <Section label="Project">
              <NavLink href={pBase} icon={LayoutDashboard} exact>
                Dashboard
              </NavLink>
              {core
                .filter((m) => moduleEnabled(project.settings, m.key))
                .map((m) => {
                  const nav = MODULE_NAV[m.key];
                  return (
                    <NavLink
                      key={m.key}
                      href={`${pBase}/${nav.path}`}
                      icon={nav.icon}
                      disabled={!m.available}
                      badge={!m.available ? `Phase ${nav.phase}` : undefined}
                    >
                      {m.label}
                    </NavLink>
                  );
                })}
            </Section>
            {labs.length > 0 && (
              <Section label="Labs">
                {labs.map((m) => (
                  <NavLink
                    key={m.key}
                    href={`${pBase}/${MODULE_NAV[m.key].path}`}
                    icon={MODULE_NAV[m.key].icon}
                    disabled
                    badge="Soon"
                  >
                    {m.label}
                  </NavLink>
                ))}
              </Section>
            )}
            {canEditProject && (
              <div className="mt-1 px-2">
                <NavLink href={`${pBase}/settings`} icon={Settings2}>
                  Project settings
                </NavLink>
              </div>
            )}
          </>
        )}
        {org && (
          <Section label="Organization">
            <NavLink href={orgBase} icon={FolderKanban} exact>
              All projects
            </NavLink>
            <NavLink href={`${orgBase}/settings/members`} icon={Users}>
              Members
            </NavLink>
            {canAudit && (
              <NavLink href={`${orgBase}/settings/audit`} icon={History}>
                Audit log
              </NavLink>
            )}
            <NavLink href={`${orgBase}/settings`} icon={Settings} exact>
              Settings
            </NavLink>
          </Section>
        )}
      </div>
      <div className="border-t p-2">
        <OrgSwitcher />
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-sidebar lg:block">
      <SidebarContent />
    </aside>
  );
}
