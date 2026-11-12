'use client';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ROLE_LABELS } from '@qaforge/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useAcceptInvitation, useMe } from '@/hooks/queries';
import { api } from '@/lib/api';
import type { Me } from '@/lib/types';

export default function InvitePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: me, isLoading } = useMe();
  const accept = useAcceptInvitation();
  const invitation = me?.pendingInvitations.find((i) => i.id === id);

  const onAccept = async () => {
    try {
      const res = await accept.mutateAsync(id);
      const fresh = await api.get<Me>('/v1/me');
      const org = fresh.organizations.find((o) => o.id === res.organizationId);
      toast.success(`You joined ${org?.name ?? 'the organization'}`);
      router.replace(org ? `/${org.slug}` : '/');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not accept invitation');
    }
  };

  if (isLoading) return <Loader2 className="m-auto size-5 animate-spin text-muted-foreground" />;
  return (
    <div className="m-auto w-full max-w-sm p-6">
      <Card>
        {invitation ? (
          <>
            <CardHeader>
              <CardTitle>Join {invitation.organization.name}</CardTitle>
              <CardDescription>
                You were invited as <strong>{ROLE_LABELS[invitation.role]}</strong>.
              </CardDescription>
            </CardHeader>
            <CardFooter className="gap-2">
              <Button onClick={onAccept} disabled={accept.isPending}>
                {accept.isPending && <Loader2 className="animate-spin" />} Accept invitation
              </Button>
              <Button variant="ghost" asChild>
                <Link href="/">Not now</Link>
              </Button>
            </CardFooter>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle>Invitation unavailable</CardTitle>
              <CardDescription>
                It may have expired, been revoked, or been sent to a different email than{' '}
                {me?.user.email}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href="/">Go home</Link>
              </Button>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
