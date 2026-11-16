import { describe, expect, it } from 'vitest';
import {
  bugAgent,
  FakeProvider,
  parseUserAgent,
  redactText,
  runAgent,
  secretValues,
  type BugAgentOutput,
  type StructuredRequest,
} from './index';
import type { z } from 'zod';

const out: BugAgentOutput = {
  title: '  Total ignores discount  ',
  summary: 'Customers are overcharged.',
  stepsToReproduce: ['Open checkout', ' ', 'Apply SAVE10'],
  expectedResult: 'Total drops by 10%',
  actualResult: 'Total stays at 120',
  severity: 'MAJOR',
  priority: 'HIGH',
  component: 'checkout',
  environment: { browser: 'Safari 17', os: null, device: null, viewport: '1280x800' },
  highlight: { x: 0.8, y: -0.1, w: 0.5, h: 0.3, label: 'Total' },
  missingInfo: [],
  confidence: 1.7,
  rationale: 'Visible in the screenshot.',
};

describe('Bug Agent', () => {
  it('clamps the highlight, keeps known components and prefers facts over guesses', async () => {
    let seen: StructuredRequest<z.ZodType> | undefined;
    const provider = new FakeProvider((req) => ((seen = req), out));
    const run = await runAgent(
      bugAgent,
      {
        projectName: 'Shop',
        note: 'Discount ignored. Login was qa@shop.test password=Hunter2!',
        browser: 'Chrome 141',
        components: ['Checkout', 'Search'],
        image: { mediaType: 'image/png', base64: 'AAAA' },
      },
      { provider, model: 'fake-model', secrets: ['Hunter2!'] },
    );
    expect(run.output.title).toBe('Total ignores discount');
    expect(run.output.stepsToReproduce).toEqual(['Open checkout', 'Apply SAVE10']);
    expect(run.output.component).toBe('Checkout');
    expect(run.output.highlight).toEqual({
      x: 0.8,
      y: 0,
      w: expect.closeTo(0.2, 5),
      h: 0.3,
      label: 'Total',
    });
    expect(run.output.environment.browser).toBe('Chrome 141');
    expect(run.output.environment.viewport).toBe('1280x800');
    expect(run.output.confidence).toBe(1);
    // Image first, then the text; the password never reaches the model.
    expect(seen!.content[0]!.type).toBe('image');
    const text = seen!.content.map((p) => (p.type === 'text' ? p.text : '')).join('');
    expect(text).not.toContain('Hunter2!');
    expect(text).toContain('<note>');
  });

  it('drops invented components and highlights without a screenshot', async () => {
    const provider = new FakeProvider(() => ({
      ...out,
      component: 'Payments',
      highlight: { x: 0.1, y: 0.1, w: 0.2, h: 0.2, label: '' },
    }));
    const run = await runAgent(
      bugAgent,
      { projectName: 'Shop', note: 'Broken' },
      { provider, model: 'm' },
    );
    expect(run.output.component).toBeNull();
    expect(run.output.highlight).toBeNull();
    expect(run.dropped).toEqual([
      'component "Payments" is not defined in the project',
      'highlight without a screenshot',
    ]);
  });

  it('drops degenerate boxes and falls back to the note for an empty title', async () => {
    const provider = new FakeProvider(() => ({
      ...out,
      title: ' ',
      highlight: { x: 1, y: 1, w: 0.4, h: 0.4, label: 'x' },
    }));
    const run = await runAgent(
      bugAgent,
      {
        projectName: 'Shop',
        note: 'Search is slow',
        image: { mediaType: 'image/png', base64: 'A' },
      },
      { provider, model: 'm' },
    );
    expect(run.output.title).toBe('Search is slow');
    expect(run.output.highlight).toBeNull();
  });

  it('parses common user agents', () => {
    expect(
      parseUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
      ),
    ).toEqual({ browser: 'Safari 17', os: 'macOS' });
    expect(
      parseUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0'),
    ).toEqual({ browser: 'Firefox 131', os: 'Linux' });
    expect(
      parseUserAgent(
        'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 Edg/141.0',
      ),
    ).toEqual({ browser: 'Edge 141', os: 'Windows' });
    expect(parseUserAgent('Mozilla/5.0 (Linux; Android 15) Chrome/141.0 Mobile')).toEqual({
      browser: 'Chrome 141',
      os: 'Android',
    });
    expect(parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toEqual({
      browser: null,
      os: 'iOS',
    });
    expect(parseUserAgent(null)).toEqual({ browser: null, os: null });
    expect(parseUserAgent('curl/8')).toEqual({ browser: null, os: null });
  });
});

describe('redaction', () => {
  it('replaces known secret values, longest first', () => {
    expect(redactText('db pass is s3cr3t-long and s3cr3t', ['s3cr3t', 's3cr3t-long'])).toBe(
      'db pass is [redacted] and [redacted]',
    );
    expect(redactText('abc', ['', 'ab'])).toBe('abc'); // too short to be meaningful
  });

  it('masks common credential shapes', () => {
    const cases: [string, string][] = [
      ['key sk-ant-api03-AAAAAAAAAAAAAAAA', 'key [redacted key]'],
      ['stripe sk_live_abcdefghijklmnop', 'stripe [redacted key]'],
      ['gh ghp_abcdefghijklmnopqrstuvwxyz0123', 'gh [redacted token]'],
      ['aws AKIAABCDEFGHIJKLMNOP', 'aws [redacted key]'],
      ['Authorization: Bearer abcdefghijklmnopqrstuvwxyz', 'Authorization: Bearer [redacted]'],
      [
        'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
        'jwt [redacted token]',
      ],
      ['postgres://app:Sup3rS3cret@db:5432/app', 'postgres://app:[redacted]@db:5432/app'],
      ['password=hunter2', 'password=[redacted]'],
      ['API_KEY: "abc123xyz"', 'API_KEY: "[redacted]"'],
      [
        '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----',
        '[redacted private key]',
      ],
      ['slack xoxb-1234567890-abcdef', 'slack [redacted token]'],
      ['google AIzaSyA1234567890abcdefghijklmnopqrstu', 'google [redacted key]'],
    ];
    for (const [input, expected] of cases) expect(redactText(input)).toBe(expected);
  });

  it('leaves requirement prose readable', () => {
    const prose =
      'Password: required. Passwords must be at least 12 characters. Token expiry is configurable.';
    expect(redactText(prose)).toBe(prose);
  });

  it('collects string leaves from secret objects', () => {
    expect(secretValues({ a: 'x', b: ['y', { c: 'z' }], d: 3, e: null })).toEqual(['x', 'y', 'z']);
  });
});
