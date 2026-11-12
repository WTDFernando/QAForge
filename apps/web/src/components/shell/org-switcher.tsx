'use client';
import Link from 'next/link';
import { ChevronsUpDown, Plus } from 'lucide-react';
import { ROLE_LABELS } from '@qaforge/shared';
import {
  DropdownMenu,
  DropdownMenuCheckItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCurrentOrg, useMe } from '@/hooks/queries';

export function OrgSwitcher() {
  const { data: me } = useMe();
  const { org } = useCurrentOrg();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-foreground text-[11px] font-bold text-background">
          {org?.name[0]?.toUpperCase() ?? '·'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            {org?.name ?? 'Select organization'}
          </span>
          {org && (
            <span className="block truncate text-xs text-muted-foreground">
              {ROLE_LABELS[org.role]}
            </span>
          )}
        </span>
        <ChevronsUpDown className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {me?.organizations.map((o) => (
          <DropdownMenuCheckItem key={o.id} checked={o.id === org?.id} asChild>
            <Link href={`/${o.slug}`}>{o.name}</Link>
          </DropdownMenuCheckItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding">
            <Plus /> New organization
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
