import { AlertTriangle, Lock, type LucideIcon } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from './button';

/** Empty, error and permission-denied states (Definition of Done: every screen handles all three). */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-16 text-center',
        className,
      )}
    >
      <div className="mb-1 flex size-11 items-center justify-center rounded-xl bg-primary-subtle text-primary">
        <Icon className="size-5" aria-hidden />
      </div>
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  error,
  retry,
  what = 'this page',
  className,
}: {
  error: unknown;
  retry?: () => void;
  what?: string;
  className?: string;
}) {
  const status = error instanceof ApiError ? error.status : 0;
  if (status === 403)
    return (
      <EmptyState
        className={className}
        icon={Lock}
        title="You don’t have access"
        description={`Your role can’t open ${what}. Ask a QA Lead or Admin if you need it.`}
      />
    );
  if (status === 404)
    return (
      <EmptyState
        className={className}
        icon={AlertTriangle}
        title="Not found"
        description={`We couldn’t find ${what}. It may have been deleted or moved.`}
      />
    );
  return (
    <div role="alert">
      <EmptyState
        className={className}
        icon={AlertTriangle}
        title={`Couldn’t load ${what}`}
        description={error instanceof Error ? error.message : 'Something went wrong.'}
        action={
          retry && (
            <Button variant="outline" onClick={retry}>
              Try again
            </Button>
          )
        }
      />
    </div>
  );
}
