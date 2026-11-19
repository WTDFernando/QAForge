import { describe, expect, it } from 'vitest';
import { detectFormat } from '@/components/automation/import-dialog';

describe('import format detection', () => {
  it('recognises each supported format from its contents', () => {
    expect(detectFormat("curl 'https://api.test/x' -H 'a: b'")).toBe('curl');
    expect(detectFormat('openapi: 3.0.0\ninfo:\n  title: T')).toBe('openapi');
    expect(detectFormat('{"swagger":"2.0","info":{}}')).toBe('openapi');
    expect(detectFormat('{"info":{"_postman_id":"1","name":"x"},"item":[]}')).toBe('postman');
    expect(detectFormat('meta {\n  name: Get\n}\nget {\n  url: x\n}')).toBe('bruno');
    expect(detectFormat('anything', 'req.bru')).toBe('bruno');
  });

  it('returns null when unsure, so the chosen format is kept', () => {
    expect(detectFormat('{"hello":"world"}')).toBeNull();
  });
});
