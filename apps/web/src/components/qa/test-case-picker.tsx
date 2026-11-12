'use client';
import { useState } from 'react';
import { Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useTestCases } from '@/hooks/qa';

/** Search existing test cases by title or TC-id and pick one to link. */
export function TestCasePicker({
  projectId,
  exclude,
  onPick,
}: {
  projectId: string;
  exclude: string[];
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const list = useTestCases(
    open ? projectId : undefined,
    new URLSearchParams({ q, pageSize: '20' }).toString(),
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          <Link2 /> Link existing
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search test cases…" value={q} onValueChange={setQ} />
          <CommandList>
            <CommandEmpty>{list.isFetching ? 'Searching…' : 'No test cases found.'}</CommandEmpty>
            <CommandGroup>
              {list.data?.items
                .filter((t) => !exclude.includes(t.id))
                .map((t) => (
                  <CommandItem
                    key={t.id}
                    value={t.id}
                    onSelect={() => (onPick(t.id), setOpen(false))}
                  >
                    <span className="font-mono text-xs text-muted-foreground">{t.ref}</span>
                    <span className="truncate">{t.title}</span>
                  </CommandItem>
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
