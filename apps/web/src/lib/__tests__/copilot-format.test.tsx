import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { renderCopilotMarkdown } from '../copilot-format';

describe('copilot markdown', () => {
  const resolve = (ref: string) => (ref.startsWith('TC-') ? `/tc/${ref}` : null);
  it('renders lists, bold, code and item links without raw HTML', () => {
    const { container } = render(
      <>
        {renderCopilotMarkdown(
          'Two gaps:\n- **REQ-0003** has no tests\n- TC-0004 uses `4242`\n\n1. first\n2. <b>x</b>',
          resolve,
        )}
      </>,
    );
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
    expect(container.querySelector('strong')?.textContent).toBe('REQ-0003');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/tc/TC-0004');
    expect(container.querySelector('code')?.textContent).toBe('4242');
    expect(container.querySelector('b')).toBeNull(); // HTML is shown as text, never parsed
    expect(container.textContent).toContain('<b>x</b>');
  });
});
