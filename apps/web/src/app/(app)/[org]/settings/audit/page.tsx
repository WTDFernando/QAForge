'use client';
import { Card, CardContent } from '@/components/ui/card';
import { AuditTimeline } from '@/components/org/audit-timeline';
import { useCurrentOrg } from '@/hooks/queries';

export default function AuditPage() {
  const { org } = useCurrentOrg();
  if (!org) return null;
  return (
    <Card className="max-w-3xl">
      <CardContent className="pt-5">
        <AuditTimeline orgId={org.id} />
      </CardContent>
    </Card>
  );
}
