'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SidebarContent } from './sidebar';
import { useUiState } from './ui-state';

/** Slide-in sidebar for tablet/phone widths. */
export function MobileNav() {
  const { mobileNavOpen, setMobileNavOpen } = useUiState();
  const pathname = usePathname();
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname, setMobileNavOpen]);
  return (
    <DialogPrimitive.Root open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
      <DialogPrimitive.Trigger asChild>
        <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Open navigation">
          <Menu />
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-72 border-r bg-sidebar shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-left">
          <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
          <SidebarContent />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
