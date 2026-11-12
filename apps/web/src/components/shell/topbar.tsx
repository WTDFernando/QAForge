'use client';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { LogOut, Moon, Search, Sun, Monitor } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
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
import { useUiState } from './ui-state';

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
    <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur">
      <div className="min-w-0 flex-1">{children}</div>
      <Button
        variant="outline"
        size="sm"
        className="w-56 justify-start text-muted-foreground"
        onClick={() => setPaletteOpen(true)}
      >
        <Search /> <span className="flex-1 text-left">Search or jump to…</span>
        <Kbd>⌘K</Kbd>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label="Account menu"
        >
          <Avatar name={me?.user.name ?? '?'} src={me?.user.image} />
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
