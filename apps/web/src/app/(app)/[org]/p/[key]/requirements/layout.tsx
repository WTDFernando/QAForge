import { RequirementsWorkspace } from '@/components/requirements/workspace';

export default function RequirementsLayout({ children }: { children: React.ReactNode }) {
  return <RequirementsWorkspace>{children}</RequirementsWorkspace>;
}
