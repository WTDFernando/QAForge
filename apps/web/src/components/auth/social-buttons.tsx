'use client';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { signIn } from '@/lib/auth-client';

const LABELS: Record<string, string> = { google: 'Google', microsoft: 'Microsoft' };

export function SocialButtons({ callbackURL }: { callbackURL: string }) {
  const { data } = useQuery({
    queryKey: ['auth-providers'],
    queryFn: () => api.get<{ social: string[] }>('/v1/auth/providers'),
    staleTime: Infinity,
  });
  const providers = data?.social ?? [];
  if (providers.length === 0) return null;
  return (
    <>
      <div className="grid gap-2">
        {providers.map((p) => (
          <Button
            key={p}
            variant="outline"
            type="button"
            onClick={() =>
              signIn.social({
                provider: p as 'google' | 'microsoft',
                callbackURL: `${window.location.origin}${callbackURL}`,
              })
            }
          >
            Continue with {LABELS[p] ?? p}
          </Button>
        ))}
      </div>
      <div className="relative text-center text-xs text-muted-foreground after:absolute after:inset-0 after:top-1/2 after:z-0 after:border-t">
        <span className="relative z-10 bg-background px-2">or with email</span>
      </div>
    </>
  );
}
