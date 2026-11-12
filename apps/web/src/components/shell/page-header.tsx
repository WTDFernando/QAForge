import { Topbar } from './topbar';

export function PageHeader({
  breadcrumb,
  title,
  description,
  actions,
}: {
  breadcrumb?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <>
      <Topbar>
        <div className="truncate text-sm text-muted-foreground">{breadcrumb}</div>
      </Topbar>
      <div className="flex flex-wrap items-end justify-between gap-4 px-6 pt-6 pb-4 lg:px-8">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </>
  );
}
