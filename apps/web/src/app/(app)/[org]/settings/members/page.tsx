'use client';
import { useMemo, useState } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowUpDown, MoreHorizontal, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { canAssignRole, ROLE_LABELS, ROLES, type Role } from '@qaforge/shared';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { InviteDialog } from '@/components/org/invite-dialog';
import {
  useCurrentOrg,
  useInvitations,
  useMe,
  useMembers,
  useRemoveMember,
  useRevokeInvite,
  useUpdateMemberRole,
} from '@/hooks/queries';
import { useCan } from '@/hooks/use-permission';
import type { Member } from '@/lib/types';
import { timeAgo } from '@/lib/utils';

const col = createColumnHelper<Member>();

export default function MembersPage() {
  const { org } = useCurrentOrg();
  const { data: me } = useMe();
  const members = useMembers(org?.id);
  const canManage = useCan('members:manage');
  const invitations = useInvitations(org?.id, canManage);
  const updateRole = useUpdateMemberRole(org?.id ?? '');
  const remove = useRemoveMember(org?.id ?? '');
  const revoke = useRevokeInvite(org?.id ?? '');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filter, setFilter] = useState('');

  const columns = useMemo(() => {
    const myRole = org?.role;
    return [
      col.accessor((m) => `${m.user.name} ${m.user.email}`, {
        id: 'member',
        header: ({ column }) => (
          <button className="inline-flex items-center gap-1" onClick={() => column.toggleSorting()}>
            Member <ArrowUpDown className="size-3" />
          </button>
        ),
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Avatar name={row.original.user.name} src={row.original.user.image} />
            <div>
              <div className="font-medium">
                {row.original.user.name}{' '}
                {row.original.user.id === me?.user.id && (
                  <span className="text-xs text-muted-foreground">(you)</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">{row.original.user.email}</div>
            </div>
          </div>
        ),
      }),
      col.accessor('role', {
        header: ({ column }) => (
          <button className="inline-flex items-center gap-1" onClick={() => column.toggleSorting()}>
            Role <ArrowUpDown className="size-3" />
          </button>
        ),
        sortingFn: (a, b) => ROLES.indexOf(a.original.role) - ROLES.indexOf(b.original.role),
        cell: ({ row }) => {
          const m = row.original;
          const editable =
            canManage && myRole && canAssignRole(myRole, m.role) && m.user.id !== me?.user.id;
          if (!editable)
            return (
              <Badge variant={m.role === 'OWNER' ? 'default' : 'secondary'}>
                {ROLE_LABELS[m.role]}
              </Badge>
            );
          return (
            <Select
              value={m.role}
              onValueChange={(role) =>
                updateRole.mutate(
                  { memberId: m.id, role: role as Role },
                  {
                    onSuccess: () =>
                      toast.success(`${m.user.name} is now ${ROLE_LABELS[role as Role]}`),
                    onError: (e) => toast.error(e.message),
                  },
                )
              }
            >
              <SelectTrigger size="sm" aria-label={`Role for ${m.user.name}`} className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.filter((r) => canAssignRole(myRole, r)).map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        },
      }),
      col.accessor('createdAt', {
        header: 'Joined',
        cell: (c) => <span className="text-muted-foreground">{timeAgo(c.getValue())}</span>,
      }),
      col.display({
        id: 'actions',
        cell: ({ row }) => {
          const m = row.original;
          const isSelf = m.user.id === me?.user.id;
          const canRemove = isSelf || (canManage && myRole && canAssignRole(myRole, m.role));
          if (!canRemove) return null;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Member actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() =>
                    remove.mutate(m.id, {
                      onSuccess: () =>
                        toast.success(
                          isSelf ? 'You left the organization' : `${m.user.name} removed`,
                        ),
                      onError: (e) => toast.error(e.message),
                    })
                  }
                >
                  {isSelf ? 'Leave organization' : 'Remove from organization'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      }),
    ];
  }, [org?.role, me?.user.id, canManage, updateRole, remove]);

  const table = useReactTable({
    data: members.data ?? [],
    columns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className="grid max-w-4xl gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-72">
          <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Filter members…"
            className="pl-8"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        {canManage && <InviteDialog />}
      </div>
      <Card className="p-0">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((h) => (
                  <TableHead key={h.id}>
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {members.isLoading
              ? [0, 1, 2].map((i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={4}>
                      <Skeleton className="h-8" />
                    </TableCell>
                  </TableRow>
                ))
              : table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </Card>
      {canManage && !!invitations.data?.length && (
        <div className="grid gap-2">
          <h2 className="text-sm font-medium">Pending invitations</h2>
          <Card className="divide-y p-0">
            {invitations.data.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="flex-1">{inv.email}</span>
                <Badge variant="secondary">{ROLE_LABELS[inv.role]}</Badge>
                <span className="text-xs text-muted-foreground">
                  expires {timeAgo(inv.expiresAt)}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Revoke invitation for ${inv.email}`}
                  onClick={() =>
                    revoke.mutate(inv.id, { onSuccess: () => toast.success('Invitation revoked') })
                  }
                >
                  <X />
                </Button>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
