'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { createOrganizationSchema, type CreateOrganizationInput } from '@qaforge/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useCurrentOrg, useUpdateOrg } from '@/hooks/queries';
import { useCan } from '@/hooks/use-permission';
import { ApiError } from '@/lib/api';

export default function GeneralSettingsPage() {
  const { org } = useCurrentOrg();
  const canEdit = useCan('org:update');
  const update = useUpdateOrg(org?.id ?? '');
  const router = useRouter();
  const form = useForm<CreateOrganizationInput>({
    resolver: zodResolver(createOrganizationSchema),
    values: org ? { name: org.name, slug: org.slug } : undefined,
  });

  useEffect(() => {
    if (org) form.reset({ name: org.name, slug: org.slug });
  }, [org, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const updated = await update.mutateAsync(values);
      toast.success('Settings saved');
      if (updated.slug !== org?.slug) router.replace(`/${updated.slug}/settings`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) form.setError('slug', { message: e.message });
      else toast.error(e instanceof Error ? e.message : 'Could not save');
    }
  });
  const { errors, isSubmitting, isDirty } = form.formState;

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base">General</CardTitle>
        <CardDescription>
          {canEdit
            ? 'Name and URL of your organization.'
            : 'Only Owners and Admins can change these settings.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <FormField id="name" label="Name" error={errors.name?.message}>
            <Input id="name" disabled={!canEdit} {...form.register('name')} />
          </FormField>
          <FormField
            id="slug"
            label="URL slug"
            error={errors.slug?.message}
            hint="Changing this changes every link to your workspace."
          >
            <Input id="slug" disabled={!canEdit} {...form.register('slug')} />
          </FormField>
          {canEdit && (
            <div>
              <Button type="submit" disabled={!isDirty || isSubmitting}>
                {isSubmitting && <Loader2 className="animate-spin" />} Save changes
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
