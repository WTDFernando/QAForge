import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api';

const respond = (status: number, body?: unknown) =>
  vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    statusText: 'x',
    json: () => (body === undefined ? Promise.reject() : Promise.resolve(body)),
  });

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('sends JSON and returns data', async () => {
    const f = respond(200, { id: 1 });
    vi.stubGlobal('fetch', f);
    await expect(api.post('/v1/x', { a: 1 })).resolves.toEqual({ id: 1 });
    expect(f).toHaveBeenCalledWith(
      '/v1/x',
      expect.objectContaining({ method: 'POST', body: '{"a":1}', credentials: 'include' }),
    );
  });
  it('handles 204', async () => {
    vi.stubGlobal('fetch', respond(204));
    await expect(api.delete('/v1/x')).resolves.toBeUndefined();
  });
  it('throws ApiError with server message', async () => {
    vi.stubGlobal('fetch', respond(409, { message: 'taken', errors: [1] }));
    const err = await api.get('/v1/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, message: 'taken', details: [1] });
  });
});
