'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useCurrentOrg } from '@/hooks/queries';
import { CreateProjectDialog } from '@/components/projects/create-project-dialog';
import { CommandPalette } from './command-palette';
import { Sidebar } from './sidebar';
import { UiStateProvider } from './ui-state';

export const LAST_ORG_KEY = 'qaforge:lastOrg';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { org, notFound } = useCurrentOrg();
  const params = useParams<{ org?: string }>();

  useEffect(() => {
    if (org) {
      try {
        localStorage.setItem(LAST_ORG_KEY, org.slug);
      } catch {}
    }
  }, [org]);

  return (
    <UiStateProvider>
      <div className="flex h-screen overflow-hidden">
        {params.org && <Sidebar />}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {notFound ? (
            <div className="m-auto max-w-sm text-center">
              <h1 className="text-lg font-semibold">Organization not found</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                It doesn&apos;t exist or you don&apos;t have access.
              </p>
              <Button asChild className="mt-4">
                <Link href="/">Go home</Link>
              </Button>
            </div>
          ) : (
            children
          )}
        </div>
      </div>
      <CommandPalette />
      {org && <CreateProjectDialog />}
    </UiStateProvider>
  );
}
