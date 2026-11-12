'use client';
import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  Building2,
  FolderKanban,
  History,
  LogOut,
  Moon,
  Plus,
  Settings,
  Sun,
  Users,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
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
import { useCurrentOrg, useMe, useProjects } from '@/hooks/queries';
import { useHotkey } from '@/hooks/use-hotkey';
import { useCan } from '@/hooks/use-permission';
import { signOut } from '@/lib/auth-client';
import { useUiState } from './ui-state';

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, setCreateProjectOpen } = useUiState();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { data: me } = useMe();
  const { org } = useCurrentOrg();
  const projects = useProjects(org?.id);
  const canCreate = useCan('project:create');
  const qc = useQueryClient();

  useHotkey(
    'mod+k',
    useCallback(() => setPaletteOpen(!paletteOpen), [paletteOpen, setPaletteOpen]),
  );
  useHotkey(
    'c',
    useCallback(() => canCreate && setCreateProjectOpen(true), [canCreate, setCreateProjectOpen]),
    !paletteOpen,
  );

  const run = (fn: () => void) => {
    setPaletteOpen(false);
    fn();
  };
  const base = org ? `/${org.slug}` : '';

  return (
    <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-xl" showClose={false}>
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command loop>
          <CommandInput placeholder="Type a command or search…" />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            {canCreate && (
              <CommandGroup heading="Actions">
                <CommandItem onSelect={() => run(() => setCreateProjectOpen(true))}>
                  <Plus /> Create project <CommandShortcut>C</CommandShortcut>
                </CommandItem>
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
              <CommandGroup heading="Navigate">
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
