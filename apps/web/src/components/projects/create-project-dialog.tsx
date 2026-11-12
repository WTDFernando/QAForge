'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { createProjectSchema, type CreateProjectInput } from '@qaforge/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input, Textarea } from '@/components/ui/input';
import { useCreateProject, useCurrentOrg } from '@/hooks/queries';
import { ApiError } from '@/lib/api';
import { suggestProjectKey } from '@/lib/utils';
import { useUiState } from '@/components/shell/ui-state';

/** One dialog, reachable from the sidebar "+", the empty state, the palette, or the "C" key. */
export function CreateProjectDialog() {
  const { createProjectOpen, setCreateProjectOpen } = useUiState();
  return (
    <Dialog open={createProjectOpen} onOpenChange={setCreateProjectOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Projects hold requirements, test cases, runs, bugs and releases.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so every open starts from a clean form. */}
        {createProjectOpen && <CreateProjectForm onDone={() => setCreateProjectOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function CreateProjectForm({ onDone }: { onDone: () => void }) {
  const { org } = useCurrentOrg();
  const router = useRouter();
  const create = useCreateProject(org?.id ?? '');
  const [keyTouched, setKeyTouched] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const form = useForm<CreateProjectInput>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: { name: '', key: '', description: '' },
  });
  const name = useWatch({ control: form.control, name: 'name' });

  useEffect(() => {
    if (!keyTouched)
      form.setValue('key', suggestProjectKey(name), { shouldValidate: form.formState.isSubmitted });
  }, [name, keyTouched, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const project = await create.mutateAsync({
        ...values,
        description: values.description || undefined,
      });
      toast.success(`Project ${project.name} created`);
      onDone();
      router.push(`/${org!.slug}/p/${project.key}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) form.setError('key', { message: e.message });
      else toast.error(e instanceof Error ? e.message : 'Could not create project');
    }
  });

  const { errors, isSubmitting } = form.formState;
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormField id="project-name" label="Name" error={errors.name?.message}>
        <Input
          id="project-name"
          placeholder="e.g. Payments"
          autoFocus
          aria-invalid={!!errors.name}
          {...form.register('name')}
        />
      </FormField>
      <FormField
        id="project-key"
        label="Key"
        error={errors.key?.message}
        hint="Used in IDs like PAY-TC-12"
      >
        <Input
          id="project-key"
          className="font-mono uppercase"
          aria-invalid={!!errors.key}
          {...form.register('key', {
            onChange: (e) => {
              setKeyTouched(true);
              e.target.value = e.target.value.toUpperCase();
            },
          })}
        />
      </FormField>
      {showMore ? (
        <FormField id="project-desc" label="Description" error={errors.description?.message}>
          <Textarea id="project-desc" rows={3} {...form.register('description')} />
        </FormField>
      ) : (
        <button
          type="button"
          onClick={() => setShowMore(true)}
          className="w-fit text-sm text-muted-foreground hover:text-foreground"
        >
          More options…
        </button>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" />} Create project
        </Button>
      </DialogFooter>
    </form>
  );
}
