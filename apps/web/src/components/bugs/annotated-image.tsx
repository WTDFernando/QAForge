import { Sparkles } from 'lucide-react';
import type { Annotation } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Screenshot with highlight boxes (normalized 0–1 coordinates) drawn over it. */
export function AnnotatedImage({
  src,
  alt,
  annotations,
  className,
}: {
  src: string;
  alt: string;
  annotations: Annotation[];
  className?: string;
}) {
  return (
    <figure className={cn('relative overflow-hidden rounded-lg border bg-muted', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="block h-auto w-full" />
      {annotations.map((a, i) => (
        <div
          key={i}
          className="pointer-events-none absolute rounded-md border-2 border-dashed border-destructive bg-destructive/5"
          style={{
            left: `${a.x * 100}%`,
            top: `${a.y * 100}%`,
            width: `${a.w * 100}%`,
            height: `${a.h * 100}%`,
          }}
        >
          {a.label && (
            <span className="absolute top-full left-0 mt-1 inline-flex items-center gap-1 rounded bg-destructive px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-white">
              {a.source === 'ai' && <Sparkles className="size-3" aria-hidden />}
              {a.label}
            </span>
          )}
        </div>
      ))}
      {annotations.length > 0 && (
        <figcaption className="sr-only">
          Highlighted: {annotations.map((a) => a.label || 'area').join(', ')}
        </figcaption>
      )}
    </figure>
  );
}
