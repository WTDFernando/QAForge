'use client';
import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import Editor, { DiffEditor, loader, type Monaco } from '@monaco-editor/react';
import { Skeleton } from '@/components/ui/skeleton';

// Monaco is served from this app (copied to /public/monaco at build time), never from a CDN.
// The URL must be absolute: Monaco's web workers resolve it outside the page.
if (typeof window !== 'undefined')
  loader.config({ paths: { vs: `${window.location.origin}/monaco/vs` } });

/** Type hints for Playwright tests, so `page.` autocompletes without shipping the real .d.ts. */
const PLAYWRIGHT_TYPES = `
declare module '@playwright/test' {
  type Locator = {
    click(o?: object): Promise<void>; fill(v: string): Promise<void>; press(k: string): Promise<void>;
    check(): Promise<void>; selectOption(v: string | string[]): Promise<string[]>; hover(): Promise<void>;
    getByRole(role: string, o?: { name?: string | RegExp; exact?: boolean }): Locator;
    getByText(t: string | RegExp): Locator; getByLabel(t: string | RegExp): Locator;
    getByTestId(id: string): Locator; locator(s: string): Locator; first(): Locator; nth(i: number): Locator;
    textContent(): Promise<string | null>; count(): Promise<number>; isVisible(): Promise<boolean>;
  };
  type Page = Locator & {
    goto(url: string, o?: object): Promise<unknown>; url(): string; title(): Promise<string>;
    waitForURL(u: string | RegExp): Promise<void>; reload(): Promise<unknown>;
    screenshot(o?: object): Promise<Buffer>;
  };
  type Matchers = {
    toBeVisible(): Promise<void>; toBeHidden(): Promise<void>; toHaveText(t: string | RegExp): Promise<void>;
    toContainText(t: string | RegExp): Promise<void>; toHaveURL(u: string | RegExp): Promise<void>;
    toHaveTitle(t: string | RegExp): Promise<void>; toHaveCount(n: number): Promise<void>;
    toHaveValue(v: string | RegExp): Promise<void>; toBeEnabled(): Promise<void>; toBeDisabled(): Promise<void>;
    toBe(v: unknown): void; toEqual(v: unknown): void; toBeTruthy(): void; not: Matchers;
  };
  export const expect: (v: unknown) => Matchers;
  type Fixtures = { page: Page; baseURL: string };
  type TestFn = (name: string, fn: (f: Fixtures) => Promise<void>) => void;
  export const test: TestFn & {
    describe: (name: string, fn: () => void) => void; beforeEach: (fn: (f: Fixtures) => Promise<void>) => void;
    step: <T>(name: string, fn: () => Promise<T>) => Promise<T>; skip: TestFn; only: TestFn;
  };
  export type { Page, Locator };
}
declare const process: { env: Record<string, string | undefined> };
`;

let typesAdded = false;
function beforeMount(monaco: Monaco) {
  if (typesAdded) return;
  typesAdded = true;
  const ts = monaco.languages.typescript;
  ts.typescriptDefaults.setCompilerOptions({
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    strict: true,
    allowNonTsExtensions: true,
  });
  ts.typescriptDefaults.addExtraLib(PLAYWRIGHT_TYPES, 'file:///node_modules/@playwright/test.d.ts');
}

const OPTIONS = {
  fontSize: 13,
  fontFamily: 'var(--font-mono), ui-monospace, monospace',
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  tabSize: 2,
  automaticLayout: true,
  padding: { top: 10, bottom: 10 },
  renderLineHighlight: 'line' as const,
  // Tab moves focus out of the editor when toggled with Ctrl+M (Monaco's accessibility mode).
  accessibilitySupport: 'auto' as const,
};

function useEditorTheme() {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === 'dark' ? 'vs-dark' : 'light';
}

/** Avoids an endless spinner when /monaco can't be loaded (offline build, blocked path). */
function useLoadFailed() {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loader.init().catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);
  return failed;
}

export function CodeEditor({
  value,
  onChange,
  language = 'typescript',
  readOnly,
  label,
  height = '100%',
  path,
}: {
  value: string;
  onChange?: (v: string) => void;
  language?: string;
  readOnly?: boolean;
  label: string;
  height?: string | number;
  /** Model path; keeps undo history per file */
  path?: string;
}) {
  const theme = useEditorTheme();
  const failed = useLoadFailed();
  if (failed)
    return (
      <textarea
        aria-label={label}
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
        spellCheck={false}
        className="h-full min-h-60 w-full resize-none bg-card p-3 font-mono text-[13px] outline-none"
      />
    );
  return (
    <Editor
      height={height}
      language={language}
      path={path}
      value={value}
      theme={theme}
      beforeMount={beforeMount}
      onChange={(v) => onChange?.(v ?? '')}
      loading={<Skeleton className="m-3 h-40 w-[calc(100%-1.5rem)]" />}
      options={{ ...OPTIONS, readOnly, ariaLabel: label }}
    />
  );
}

export function CodeDiff({
  original,
  modified,
  label,
  height = 260,
}: {
  original: string;
  modified: string;
  label: string;
  height?: string | number;
}) {
  const theme = useEditorTheme();
  return (
    <DiffEditor
      height={height}
      language="typescript"
      original={original}
      modified={modified}
      theme={theme}
      loading={<Skeleton className="m-3 h-32 w-[calc(100%-1.5rem)]" />}
      options={{
        ...OPTIONS,
        readOnly: true,
        renderSideBySide: false,
        originalAriaLabel: `${label}: current`,
        modifiedAriaLabel: `${label}: suggested`,
      }}
    />
  );
}
