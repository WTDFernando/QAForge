'use client';
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  Building2,
  ClipboardCheck,
  FileText,
  FolderKanban,
  History,
  LayoutDashboard,
  LogOut,
  Moon,
  Plus,
  Settings,
  Sun,
  Users,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { parseRef } from '@qaforge/shared';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useCurrentOrg, useCurrentProject, useMe, useProjects } from '@/hooks/queries';
import { useRequirements } from '@/hooks/qa';
import { useHotkey } from '@/hooks/use-hotkey';
import { useCan } from '@/hooks/use-permission';
import { signOut } from '@/lib/auth-client';
import { useUiState } from './ui-state';

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, setCreateProjectOpen, createAction } = useUiState();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { data: me } = useMe();
  const { org } = useCurrentOrg();
  const { project } = useCurrentProject();
  const projects = useProjects(org?.id);
  const requirements = useRequirements(paletteOpen ? project?.id : undefined);
  const canCreateProject = useCan('project:create');
  const qc = useQueryClient();
  const [search, setSearch] = useState('');

  useHotkey(
    'mod+k',
    useCallback(() => setPaletteOpen(!paletteOpen), [paletteOpen, setPaletteOpen]),
  );
  useHotkey(
    'c',
    useCallback(() => {
      if (createAction) createAction.run();
      else if (canCreateProject) setCreateProjectOpen(true);
    }, [createAction, canCreateProject, setCreateProjectOpen]),
    !paletteOpen,
  );

  const run = (fn: () => void) => {
    setPaletteOpen(false);
    setSearch('');
    fn();
  };
  const base = org ? `/${org.slug}` : '';
  const pBase = project ? `${base}/p/${project.key}` : '';
  const ref = parseRef(search);

  return (
    <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-xl" showClose={false}>
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command loop>
          <CommandInput
            placeholder="Type a command, search, or enter an ID like TC-0042…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            {project && ref && (ref.kind === 'testCase' || ref.kind === 'requirement') && (
              <CommandGroup heading="Go to ID">
                <CommandItem
                  value={`goto ${search}`}
                  onSelect={() =>
                    run(() => {
                      if (ref.kind === 'testCase')
                        router.push(`${pBase}/test-cases/TC-${String(ref.seq).padStart(4, '0')}`);
                      else {
                        const r = requirements.data?.find((x) => x.seq === ref.seq);
                        router.push(r ? `${pBase}/requirements/${r.id}` : `${pBase}/requirements`);
                      }
                    })
                  }
                >
                  {ref.kind === 'testCase' ? <ClipboardCheck /> : <FileText />} Open{' '}
                  {search.toUpperCase()}
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup heading="Actions">
              {createAction && (
                <CommandItem onSelect={() => run(createAction.run)}>
                  <Plus /> {createAction.label} <CommandShortcut>C</CommandShortcut>
                </CommandItem>
              )}
              {canCreateProject && (
                <CommandItem onSelect={() => run(() => setCreateProjectOpen(true))}>
                  <Plus /> Create project {!createAction && <CommandShortcut>C</CommandShortcut>}
                </CommandItem>
              )}
            </CommandGroup>
            {project && (
              <CommandGroup heading={project.name}>
                <CommandItem onSelect={() => run(() => router.push(pBase))}>
                  <LayoutDashboard /> Dashboard
                </CommandItem>
                <CommandItem onSelect={() => run(() => router.push(`${pBase}/requirements`))}>
                  <FileText /> Requirements
                </CommandItem>
                <CommandItem onSelect={() => run(() => router.push(`${pBase}/test-cases`))}>
                  <ClipboardCheck /> Test cases
                </CommandItem>
                <CommandItem
                  onSelect={() => run(() => router.push(`${pBase}/test-cases?view=review`))}
                >
                  <ClipboardCheck /> Review queue
                </CommandItem>
                {requirements.data?.slice(0, 50).map((r) => (
                  <CommandItem
                    key={r.id}
                    value={`requirement ${r.ref} ${r.title}`}
                    onSelect={() => run(() => router.push(`${pBase}/requirements/${r.id}`))}
                  >
                    <FileText /> <span className="truncate">{r.title}</span>
                    <span className="ml-auto font-mono text-xs text-muted-foreground">{r.ref}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {!!projects.data?.length && (
              <CommandGroup heading="Projects">
                {projects.data.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={`project ${p.name} ${p.key}`}
                    onSelect={() => run(() => router.push(`${base}/p/${p.key}`))}
                  >
                    <FolderKanban /> {p.name}
                    <span className="ml-auto font-mono text-xs text-muted-foreground">{p.key}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {org && (
              <CommandGroup heading="Organization">
                <CommandItem onSelect={() => run(() => router.push(base))}>
                  <FolderKanban /> All projects
                </CommandItem>
                <CommandItem onSelect={() => run(() => router.push(`${base}/settings/members`))}>
                  <Users /> Members
                </CommandItem>
                <CommandItem onSelect={() => run(() => router.push(`${base}/settings/audit`))}>
                  <History /> Audit log
                </CommandItem>
                <CommandItem onSelect={() => run(() => router.push(`${base}/settings`))}>
                  <Settings /> Organization settings
                </CommandItem>
              </CommandGroup>
            )}
            {(me?.organizations.length ?? 0) > 1 && (
              <CommandGroup heading="Switch organization">
                {me!.organizations
                  .filter((o) => o.id !== org?.id)
                  .map((o) => (
                    <CommandItem
                      key={o.id}
                      value={`org ${o.name}`}
                      onSelect={() => run(() => router.push(`/${o.slug}`))}
                    >
                      <Building2 /> {o.name}
                    </CommandItem>
                  ))}
              </CommandGroup>
            )}
            <CommandGroup heading="Preferences">
              <CommandItem
                onSelect={() => run(() => setTheme(theme === 'dark' ? 'light' : 'dark'))}
              >
                {theme === 'dark' ? <Sun /> : <Moon />} Toggle theme
              </CommandItem>
              <CommandItem
                onSelect={() =>
                  run(async () => {
                    await signOut();
                    qc.clear();
                    router.replace('/login');
                  })
                }
              >
                <LogOut /> Sign out
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
