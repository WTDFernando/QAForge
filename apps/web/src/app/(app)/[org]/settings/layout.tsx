import { PageHeader } from '@/components/shell/page-header';
import { SettingsNav } from '@/components/org/settings-nav';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader breadcrumb="Settings" title="Organization settings" />
      <SettingsNav />
      <div className="px-6 py-6 lg:px-8">{children}</div>
    </>
  );
}
