'use client';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Bell, Sparkles, LogOut, Monitor, Moon, Search, Sun } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuCheckItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMe } from '@/hooks/queries';
import { useMarkNotificationsRead, useNotifications } from '@/hooks/bugs';
import { signOut } from '@/lib/auth-client';
import { MobileNav } from './mobile-nav';
import { AgentActivity } from '@/components/ai/agent-activity';
import { useCurrentProject } from '@/hooks/queries';
import { useUiState } from './ui-state';

function Notifications() {
  const router = useRouter();
  const list = useNotifications();
  const markRead = useMarkNotificationsRead();
  const unread = list.data?.unread ?? 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative"
          aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center border-b px-3 py-2">
          <p className="flex-1 text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <Button variant="ghost" size="sm" onClick={() => markRead.mutate(undefined)}>
              Mark all read
            </Button>
          )}
        </div>
        {list.isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        ) : !list.data?.items.length ? (
          <p className="p-4 text-sm text-muted-foreground">
            You&apos;re all caught up. Assignments, mentions and status changes appear here.
          </p>
        ) : (
          <ul className="max-h-96 overflow-y-auto py-1">
            {list.data.items.map((n) => (
              <li key={n.id}>
                <button
                  className="flex w-full gap-2.5 px-3 py-2 text-left hover:bg-accent"
                  onClick={() => {
                    if (!n.readAt) markRead.mutate(n.id);
                    if (n.href) router.push(n.href);
                  }}
                >
                  <span
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-primary'}`}
                    aria-label={n.readAt ? undefined : 'Unread'}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${n.readAt ? '' : 'font-semibold'}`}>
                      {n.title}
                    </span>
                    {n.body && (
                      <span className="block truncate text-xs text-muted-foreground">{n.body}</span>
                    )}
                    <time className="text-[11px] text-muted-foreground" dateTime={n.createdAt}>
                      {new Date(n.createdAt).toLocaleString()}
                    </time>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function Topbar({ children }: { children?: React.ReactNode }) {
  const { data: me } = useMe();
  const { setPaletteOpen, copilotOpen, setCopilotOpen } = useUiState();
  const { project } = useCurrentProject();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();

  const logout = async () => {
    await signOut();
    qc.clear();
    router.replace('/login');
  };

  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
      <MobileNav />
      <div className="min-w-0 flex-1">{children}</div>
      <Button
        variant="outline"
        size="sm"
        className="hidden w-56 justify-start text-muted-foreground sm:flex"
        onClick={() => setPaletteOpen(true)}
      >
        <Search /> <span className="flex-1 text-left">Search or jump to…</span>
        <Kbd>⌘K</Kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="sm:hidden"
        aria-label="Search"
        onClick={() => setPaletteOpen(true)}
      >
        <Search />
      </Button>
      {project && (
        <Button
          variant={copilotOpen ? 'secondary' : 'ghost'}
          size="sm"
          className="gap-1.5"
          onClick={() => setCopilotOpen(!copilotOpen)}
          aria-pressed={copilotOpen}
        >
          <Sparkles className="size-4 text-violet-500" />{' '}
          <span className="hidden md:inline">Copilot</span>
          <Kbd className="hidden md:inline-flex">⌘J</Kbd>
        </Button>
      )}
      <AgentActivity />
      <Notifications />
      <DropdownMenu>
        <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <Avatar name={me?.user.name ?? '?'} src={me?.user.image} />
          <span className="sr-only">{me?.user.name ?? 'Account'}: account menu</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-foreground">
            <div className="truncate font-medium">{me?.user.name}</div>
            <div className="truncate text-xs font-normal text-muted-foreground">
              {me?.user.email}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuCheckItem checked={theme === 'light'} onSelect={() => setTheme('light')}>
            <Sun className="size-4" /> Light
          </DropdownMenuCheckItem>
          <DropdownMenuCheckItem checked={theme === 'dark'} onSelect={() => setTheme('dark')}>
            <Moon className="size-4" /> Dark
          </DropdownMenuCheckItem>
          <DropdownMenuCheckItem checked={theme === 'system'} onSelect={() => setTheme('system')}>
            <Monitor className="size-4" /> System
          </DropdownMenuCheckItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={logout}>
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
