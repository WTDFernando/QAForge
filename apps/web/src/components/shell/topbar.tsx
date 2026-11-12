'use client';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Bell, Bot, LogOut, Monitor, Moon, Search, Sun } from 'lucide-react';
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
import { signOut } from '@/lib/auth-client';
import { MobileNav } from './mobile-nav';
import { useUiState } from './ui-state';

/** Shows what AI agents are doing. Agents arrive in Phase 3; until then it reports idle. */
function AgentActivity() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="AI agent activity: idle">
          <span className="relative">
            <Bot className="size-4" />
            <span className="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-muted-foreground/60 ring-2 ring-background" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <p className="text-sm font-medium">AI agents</p>
        <p className="mt-1 text-sm text-muted-foreground">
          No agents running. Progress of test case generation, bug drafting and reports will show
          here.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function Notifications() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Notifications">
          <Bell className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <p className="text-sm font-medium">Notifications</p>
        <p className="mt-1 text-sm text-muted-foreground">
          You&apos;re all caught up. Reviews, assignments and approvals will appear here.
        </p>
      </PopoverContent>
    </Popover>
  );
}

export function Topbar({ children }: { children?: React.ReactNode }) {
  const { data: me } = useMe();
  const { setPaletteOpen } = useUiState();
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
