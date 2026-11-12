'use client';
import { useEffect } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { Bold, Heading2, Italic, List, ListOrdered, Quote } from 'lucide-react';
import type { RichTextNode } from '@qaforge/shared';
import { cn } from '@/lib/utils';

/** Tiptap editor. Emits the document on blur (not every keystroke) to keep saves cheap. */
export function RichTextEditor({
  value,
  onSave,
  placeholder = 'Describe the requirement…',
  editable = true,
  label,
}: {
  value: RichTextNode | null;
  onSave: (doc: RichTextNode | null) => void;
  placeholder?: string;
  editable?: boolean;
  label: string;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false } }),
      Placeholder.configure({ placeholder }),
    ],
    content: value ?? '',
    editorProps: {
      attributes: {
        class: 'prose-qa min-h-32 px-3 py-2 outline-none',
        'aria-label': label,
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
    onBlur: ({ editor }) => {
      const doc = editor.isEmpty ? null : (editor.getJSON() as RichTextNode);
      if (JSON.stringify(doc) !== JSON.stringify(value)) onSave(doc);
    },
  });

  // Reset content when switching to another item.
  useEffect(() => {
    if (editor && !editor.isFocused && JSON.stringify(editor.getJSON()) !== JSON.stringify(value)) {
      editor.commands.setContent(value ?? '', { emitUpdate: false });
    }
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive('bold'),
            italic: e.isActive('italic'),
            h2: e.isActive('heading', { level: 2 }),
            bullet: e.isActive('bulletList'),
            ordered: e.isActive('orderedList'),
            quote: e.isActive('blockquote'),
          }
        : null,
  });

  const tools = [
    {
      key: 'bold',
      icon: Bold,
      label: 'Bold',
      run: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      key: 'italic',
      icon: Italic,
      label: 'Italic',
      run: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      key: 'h2',
      icon: Heading2,
      label: 'Heading',
      run: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      key: 'bullet',
      icon: List,
      label: 'Bulleted list',
      run: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      key: 'ordered',
      icon: ListOrdered,
      label: 'Numbered list',
      run: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      key: 'quote',
      icon: Quote,
      label: 'Quote',
      run: () => editor?.chain().focus().toggleBlockquote().run(),
    },
  ] as const;

  return (
    <div className="rounded-md border border-input shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
      {editable && (
        <div
          className="flex gap-0.5 border-b px-1 py-1"
          role="toolbar"
          aria-label={`${label} formatting`}
        >
          {tools.map((t) => (
            <button
              key={t.key}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={t.run}
              aria-label={t.label}
              aria-pressed={!!state?.[t.key]}
              className={cn(
                'rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground',
                state?.[t.key] && 'bg-accent text-foreground',
              )}
            >
              <t.icon className="size-4" />
            </button>
          ))}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
