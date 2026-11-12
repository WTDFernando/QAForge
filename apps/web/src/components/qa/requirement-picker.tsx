'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
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
import { useRequirements } from '@/hooks/qa';

export function RequirementPicker({
  projectId,
  exclude,
  onPick,
}: {
  projectId: string;
  exclude: string[];
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const reqs = useRequirements(open ? projectId : undefined);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 justify-self-start px-2">
          <Plus /> Link requirement
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search requirements…" />
          <CommandList>
            <CommandEmpty>No requirements found.</CommandEmpty>
            <CommandGroup>
              {reqs.data
                ?.filter((r) => !exclude.includes(r.id))
                .map((r) => (
                  <CommandItem
                    key={r.id}
                    value={`${r.ref} ${r.title}`}
                    onSelect={() => (onPick(r.id), setOpen(false))}
                  >
                    <span className="font-mono text-xs text-muted-foreground">{r.ref}</span>
                    <span className="truncate">{r.title}</span>
                  </CommandItem>
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
