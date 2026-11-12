import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PAGES = [
  ['dashboard', '/acme/p/PAY', 'What needs my attention'],
  ['requirements', '/acme/p/PAY/requirements', 'Sources'],
  ['test cases', '/acme/p/PAY/test-cases', 'Pay with a valid Visa card'],
  ['test case', '/acme/p/PAY/test-cases/TC-0001', 'Preconditions'],
  ['project settings', '/acme/p/PAY/settings', 'Environments'],
  ['members', '/acme/settings/members', 'Olivia Owner'],
] as const;

for (const theme of ['light', 'dark'] as const) {
  test(`WCAG 2.2 AA: no serious violations (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/login');
    await page.getByLabel('Email').fill('lead@qaforge.dev');
    await page.getByLabel('Password').fill('qaforge-demo-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/acme/);
    const problems: string[] = [];
    for (const [name, url, ready] of PAGES) {
      await page.goto(url);
      await expect(page.getByText(ready).first()).toBeVisible();
      const res = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      for (const v of res.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      )) {
        problems.push(
          `${name}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target.join(' ')} — ${v.help}`,
        );
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
}
