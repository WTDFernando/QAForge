import type { ImportFormat } from '@qaforge/shared';
import { importBruno } from './bruno';
import { importCurl } from './curl';
import { importOpenApi } from './openapi';
import { importPostman } from './postman';
import { type ImportedFolder } from './types';

export * from './types';
export { importBruno, importCurl, importOpenApi, importPostman };

/** Parse an import file into a folder tree. Bruno and cURL produce a single request. */
export function importCollection(
  format: ImportFormat,
  content: string,
  fileName = '',
): ImportedFolder {
  switch (format) {
    case 'postman':
      return importPostman(content);
    case 'openapi':
      return importOpenApi(content);
    case 'bruno': {
      const r = importBruno(content, fileName);
      return { name: r.name, variables: {}, auth: { type: 'none' }, requests: [r], folders: [] };
    }
    case 'curl': {
      const r = importCurl(content);
      return { name: r.name, variables: {}, auth: { type: 'none' }, requests: [r], folders: [] };
    }
  }
}
