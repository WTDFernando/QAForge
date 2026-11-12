'use client';
import { useRef, useState } from 'react';
import { FileUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { MAX_UPLOAD_BYTES, REQUIREMENT_UPLOAD_TYPES } from '@qaforge/shared';
import { useUploadSource } from '@/hooks/qa';
import { cn } from '@/lib/utils';

const ACCEPT = '.pdf,.docx,.xlsx,.md,.markdown,.txt,.png,.jpg,.jpeg,.webp';

/** Drag-and-drop (or click) upload of requirement documents. */
export function UploadZone({
  projectId,
  compact = false,
}: {
  projectId: string;
  compact?: boolean;
}) {
  const upload = useUploadSource(projectId);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const send = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error(`${file.name} is larger than 25 MB`);
        continue;
      }
      try {
        await upload.mutateAsync(file);
        toast.success(`${file.name} uploaded`, {
          description: 'AI analysis of documents arrives in Phase 3.',
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Could not upload ${file.name}`);
      }
    }
  };

  return (
    <div
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setOver(false);
        void send(e.dataTransfer.files);
      }}
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-center transition-colors',
        compact ? 'p-4' : 'p-10',
        over ? 'border-primary bg-primary/5' : 'border-border',
      )}
    >
      {upload.isPending ? (
        <Loader2 className="size-6 animate-spin text-primary" />
      ) : (
        <FileUp className="size-6 text-muted-foreground" />
      )}
      <p className="text-sm">
        Drop requirement documents here or{' '}
        <button
          type="button"
          className="font-medium text-primary underline-offset-4 hover:underline"
          onClick={() => input.current?.click()}
        >
          browse
        </button>
      </p>
      <p className="text-xs text-muted-foreground">
        {[...new Set(Object.values(REQUIREMENT_UPLOAD_TYPES))].join(', ')} · up to 25 MB
      </p>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        aria-label="Upload requirement documents"
        onChange={(e) =>
          e.target.files && void send(e.target.files).then(() => (e.target.value = ''))
        }
      />
    </div>
  );
}
