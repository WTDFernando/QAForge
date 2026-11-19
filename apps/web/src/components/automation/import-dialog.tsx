'use client';
import { useState } from 'react';
import { FileUp } from 'lucide-react';
import { toast } from 'sonner';
import type { ImportFormat } from '@qaforge/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useImportCollection, type ApiCollectionNode } from '@/hooks/automation';
import { cn } from '@/lib/utils';

const FORMATS: { value: ImportFormat; label: string; hint: string; accept: string }[] = [
  { value: 'postman', label: 'Postman', hint: 'Collection v2.1 JSON export', accept: '.json' },
  {
    value: 'openapi',
    label: 'OpenAPI',
    hint: 'OpenAPI 3 / Swagger 2, JSON or YAML',
    accept: '.json,.yaml,.yml',
  },
  { value: 'bruno', label: 'Bruno', hint: 'A single .bru request file', accept: '.bru' },
  {
    value: 'curl',
    label: 'cURL',
    hint: 'Paste a command (e.g. "Copy as cURL")',
    accept: '.txt,.sh',
  },
];

/** Guess the format from file contents so dropping a file usually needs no extra click. */
export function detectFormat(content: string, fileName = ''): ImportFormat | null {
  const t = content.trimStart();
  if (/^curl\s/i.test(t)) return 'curl';
  if (fileName.endsWith('.bru') || /^meta\s*\{/m.test(t)) return 'bruno';
  if (/^(openapi|swagger)\s*:/m.test(t) || /"(openapi|swagger)"\s*:/.test(t)) return 'openapi';
  if (/"info"\s*:\s*\{[^}]*"_postman_id"|schema\.getpostman\.com/.test(t)) return 'postman';
  return null;
}

export function ImportDialog({
  open,
  onOpenChange,
  projectId,
  collections,
  onImported,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  collections: ApiCollectionNode[];
  onImported: (collectionId: string) => void;
}) {
  const [format, setFormat] = useState<ImportFormat>('postman');
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [target, setTarget] = useState('');
  const run = useImportCollection(projectId);
  const fmt = FORMATS.find((f) => f.value === format)!;

  async function readFiles(files: FileList | null) {
    if (!files?.length) return;
    const text = await files[0]!.text();
    setContent(text);
    setFileName(files[0]!.name);
    const d = detectFormat(text, files[0]!.name);
    if (d) setFormat(d);
  }

  function submit() {
    run.mutate(
      { format, content, fileName, collectionId: format === 'curl' && target ? target : undefined },
      {
        onSuccess: (r) => {
          toast.success(
            `Imported ${r.requests} request${r.requests === 1 ? '' : 's'} into ${r.name}`,
          );
          onImported(r.collectionId);
          onOpenChange(false);
          setContent('');
          setFileName('');
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import requests</DialogTitle>
          <DialogDescription>
            Bring in an existing collection. Secrets in the file are not stored: replace them with
            environment references like {'{{env.API_TOKEN}}'} after import.
          </DialogDescription>
        </DialogHeader>
        <div
          role="radiogroup"
          aria-label="Format"
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        >
          {FORMATS.map((f) => (
            <button
              key={f.value}
              role="radio"
              aria-checked={format === f.value}
              onClick={() => setFormat(f.value)}
              className={cn(
                'rounded-lg border p-2.5 text-left',
                format === f.value ? 'border-primary bg-primary-subtle' : 'hover:bg-accent',
              )}
            >
              <span className="block text-sm font-semibold">{f.label}</span>
              <span className="block text-[11px] text-muted-foreground">{f.hint}</span>
            </button>
          ))}
        </div>
        <label
          className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground hover:bg-accent focus-within:ring-2 focus-within:ring-ring"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void readFiles(e.dataTransfer.files);
          }}
        >
          <FileUp className="size-4" aria-hidden />
          {fileName ? (
            <span className="font-medium text-foreground">{fileName}</span>
          ) : (
            <span>Drop a file here or choose one</span>
          )}
          <input
            type="file"
            className="sr-only"
            accept={fmt.accept}
            onChange={(e) => void readFiles(e.target.files)}
          />
        </label>
        <textarea
          aria-label="File contents"
          value={content}
          spellCheck={false}
          onChange={(e) => {
            setContent(e.target.value);
            const d = detectFormat(e.target.value);
            if (d) setFormat(d);
          }}
          placeholder={
            format === 'curl'
              ? "curl 'https://api.example.com/items' -H 'accept: application/json'"
              : 'Or paste the contents'
          }
          className="h-44 w-full rounded-lg border bg-card p-3 font-mono text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {format === 'curl' && collections.length > 0 && (
          <label className="grid gap-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Add to</span>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">A new collection</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {run.isError && (
          <p
            role="alert"
            className="rounded-lg bg-destructive-subtle p-3 text-sm text-destructive-text"
          >
            {run.error.message}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!content.trim() || run.isPending}>
            {run.isPending ? 'Importing…' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
