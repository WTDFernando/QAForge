import type { ApiAuth } from '@qaforge/shared';
import type { ApiRequestSpec } from '../api/execute';

export interface ImportedFolder {
  name: string;
  variables: Record<string, string>;
  auth: ApiAuth;
  requests: ApiRequestSpec[];
  folders: ImportedFolder[];
}

export class ImportError extends Error {}

export const emptyRequest = (name: string, url: string): ApiRequestSpec => ({
  name,
  method: 'GET',
  url,
  headers: [],
  query: [],
  body: { type: 'none' },
  auth: null,
  assertions: [],
  extract: [],
});

export function countRequests(f: ImportedFolder): number {
  return f.requests.length + f.folders.reduce((a, c) => a + countRequests(c), 0);
}
