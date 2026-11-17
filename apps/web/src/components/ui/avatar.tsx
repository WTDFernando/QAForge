'use client';
import * as React from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cn, initials } from '@/lib/utils';

export function Avatar({
  name,
  src,
  className,
}: {
  name: string;
  src?: string | null;
  className?: string;
}) {
  return (
    <AvatarPrimitive.Root
      className={cn('relative flex size-7 shrink-0 overflow-hidden rounded-full', className)}
    >
      {src ? (
        <AvatarPrimitive.Image className="aspect-square size-full" src={src} alt={name} />
      ) : null}
      <AvatarPrimitive.Fallback className="flex size-full items-center justify-center rounded-full bg-primary-subtle text-[11px] font-semibold text-primary">
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
