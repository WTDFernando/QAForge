'use client';
import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Copy, Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import {
  canAssignRole,
  inviteMemberSchema,
  ROLE_LABELS,
  ROLES,
  type InviteMemberInput,
} from '@qaforge/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCurrentOrg, useInvite } from '@/hooks/queries';

export function InviteDialog() {
  const { org } = useCurrentOrg();
  const invite = useInvite(org?.id ?? '');
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const form = useForm<InviteMemberInput>({
    resolver: zodResolver(inviteMemberSchema),
    defaultValues: { email: '', role: 'QA_ENGINEER' },
  });
  const assignable = ROLES.filter((r) => org && canAssignRole(org.role, r));

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const inv = await invite.mutateAsync(values);
      setLink(`${window.location.origin}/invite/${inv.id}`);
      toast.success(`Invitation created for ${values.email}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not invite');
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          form.reset();
          setLink(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus /> Invite
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
          <DialogDescription>
            They&apos;ll join {org?.name} with the role you choose.
          </DialogDescription>
        </DialogHeader>
        {link ? (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              Share this link (email delivery arrives with notifications):
            </p>
            <div className="flex gap-2">
              <Input readOnly value={link} onFocus={(e) => e.target.select()} />
              <Button
                variant="outline"
                size="icon"
                aria-label="Copy link"
                onClick={() => {
                  void navigator.clipboard.writeText(link);
                  toast.success('Link copied');
                }}
              >
                <Copy />
              </Button>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  form.reset();
                  setLink(null);
                }}
              >
                Invite another
              </Button>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            <FormField id="invite-email" label="Email" error={form.formState.errors.email?.message}>
              <Input
                id="invite-email"
                type="email"
                autoFocus
                placeholder="teammate@company.com"
                {...form.register('email')}
              />
            </FormField>
            <FormField id="invite-role" label="Role">
              <Controller
                control={form.control}
                name="role"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="invite-role" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {assignable.map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="animate-spin" />} Send
                invitation
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
