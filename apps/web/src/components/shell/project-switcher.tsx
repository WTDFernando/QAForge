'use client';
import Link from 'next/link';
import { Check, ChevronsUpDown, LayoutGrid, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCurrentOrg, useCurrentProject, useProjects } from '@/hooks/queries';
import { useCan } from '@/hooks/use-permission';
import { useUiState } from './ui-state';

export function ProjectSwitcher() {
  const { org } = useCurrentOrg();
  const { project } = useCurrentProject();
  const projects = useProjects(org?.id);
  const canCreate = useCan('project:create');
  const { setCreateProjectOpen } = useUiState();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50">
        <span className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md bg-primary px-1 font-mono text-[10px] font-bold text-primary-foreground">
          {project?.key ?? <LayoutGrid className="size-3.5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            {project?.name ?? 'All projects'}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{org?.name}</span>
        </span>
        <span className="sr-only">: switch project</span>
        <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Projects</DropdownMenuLabel>
        {projects.data?.map((p) => (
          <DropdownMenuItem key={p.id} asChild>
            <Link href={`/${org!.slug}/p/${p.key}`}>
              <span className="w-10 font-mono text-xs text-muted-foreground">{p.key}</span>
              <span className="flex-1 truncate">{p.name}</span>
              {p.id === project?.id && <Check className="size-4" />}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {org && (
          <DropdownMenuItem asChild>
            <Link href={`/${org.slug}`}>
              <LayoutGrid /> All projects
            </Link>
          </DropdownMenuItem>
        )}
        {canCreate && (
          <DropdownMenuItem onSelect={() => setCreateProjectOpen(true)}>
            <Plus /> New project
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
