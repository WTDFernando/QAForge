'use client';
import { PlusCircle } from 'lucide-react';
import { Badge } from './badge';
import { Button } from './button';
import { Checkbox } from './checkbox';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Separator } from './separator';

/** Multi-select filter chip, e.g. "Status: Draft, Approved". */
export function FacetFilter<T extends string>({
  label,
  options,
  value,
  onChange,
  counts,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T[];
  onChange: (next: T[]) => void;
  counts?: Partial<Record<T, number>>;
}) {
  const toggle = (v: T) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="border-dashed">
          <PlusCircle /> {label}
          {value.length > 0 && (
            <>
              <Separator orientation="vertical" className="mx-1 h-4" />
              {value.length > 2 ? (
                <Badge variant="secondary">{value.length} selected</Badge>
              ) : (
                value.map((v) => (
                  <Badge key={v} variant="secondary">
                    {options.find((o) => o.value === v)?.label ?? v}
                  </Badge>
                ))
              )}
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1">
        <div role="group" aria-label={label}>
          {options.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
            >
              <Checkbox checked={value.includes(o.value)} onCheckedChange={() => toggle(o.value)} />
              <span className="flex-1">{o.label}</span>
              {counts?.[o.value] !== undefined && (
                <span className="text-xs text-muted-foreground">{counts[o.value]}</span>
              )}
            </label>
          ))}
        </div>
        {value.length > 0 && (
          <>
            <Separator className="my-1" />
            <button
              className="w-full rounded-sm px-2 py-1.5 text-center text-sm hover:bg-accent"
              onClick={() => onChange([])}
            >
              Clear filter
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
