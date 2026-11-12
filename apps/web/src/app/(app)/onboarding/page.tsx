'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Mail } from 'lucide-react';
import { toast } from 'sonner';
import {
  createOrganizationSchema,
  ROLE_LABELS,
  type CreateOrganizationInput,
} from '@qaforge/shared';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useCreateOrg, useMe } from '@/hooks/queries';
import { ApiError } from '@/lib/api';
import { slugify } from '@/lib/utils';

export default function OnboardingPage() {
  const router = useRouter();
  const { data: me } = useMe();
  const create = useCreateOrg();
  const [slugTouched, setSlugTouched] = useState(false);
  const form = useForm<CreateOrganizationInput>({
    resolver: zodResolver(createOrganizationSchema),
    defaultValues: { name: '', slug: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const org = await create.mutateAsync(values);
      toast.success(`Welcome to ${org.name}!`);
      router.replace(`/${org.slug}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) form.setError('slug', { message: e.message });
      else toast.error(e instanceof Error ? e.message : 'Something went wrong');
    }
  });
  const { errors, isSubmitting } = form.formState;

  return (
    <div className="m-auto w-full max-w-md p-6">
      <Logo className="mb-8" />
      {!!me?.pendingInvitations.length && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base">You&apos;ve been invited</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {me.pendingInvitations.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 rounded-md border p-3">
                <Mail className="size-4 text-muted-foreground" />
                <div className="flex-1 text-sm">
                  <div className="font-medium">{inv.organization.name}</div>
                  <div className="text-xs text-muted-foreground">as {ROLE_LABELS[inv.role]}</div>
                </div>
                <Button size="sm" asChild>
                  <Link href={`/invite/${inv.id}`}>Review</Link>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Create your organization</CardTitle>
          <CardDescription>
            Your team&apos;s home for projects, test cases and releases.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            <FormField id="org-name" label="Organization name" error={errors.name?.message}>
              <Input
                id="org-name"
                placeholder="Acme Corp"
                autoFocus
                aria-invalid={!!errors.name}
                {...form.register('name', {
                  onChange: (e) => !slugTouched && form.setValue('slug', slugify(e.target.value)),
                })}
              />
            </FormField>
            <FormField id="org-slug" label="URL" error={errors.slug?.message}>
              <div className="flex items-center rounded-md border border-input shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
                <span className="pl-3 text-sm text-muted-foreground">qaforge.app/</span>
                <Input
                  id="org-slug"
                  className="border-0 pl-0.5 shadow-none focus-visible:ring-0"
                  aria-invalid={!!errors.slug}
                  {...form.register('slug', { onChange: () => setSlugTouched(true) })}
                />
              </div>
            </FormField>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" />} Create organization
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
