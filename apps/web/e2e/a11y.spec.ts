import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PAGES = [
  ['dashboard', '/acme/p/PAY', 'What needs my attention'],
  ['requirements', '/acme/p/PAY/requirements', 'Sources'],
  ['test cases', '/acme/p/PAY/test-cases', 'Review queue'],
  ['test case', '/acme/p/PAY/test-cases/TC-0001', 'Preconditions'],
  ['project settings', '/acme/p/PAY/settings', 'Environments'],
  ['test runs', '/acme/p/PAY/runs', 'Pass rate'],
  ['run execution', '/acme/p/PAY/runs/RUN-0001', 'Preconditions'],
  ['bugs board', '/acme/p/PAY/bugs', 'Ready for retest'],
  ['bug detail', '/acme/p/PAY/bugs/BUG-0001', 'Steps to reproduce'],
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
      // Toasts from parallel jobs animate in mid-scan; settled toasts are covered by their own test below.
      // Colour transitions (e.g. while the theme class is applied) can be sampled mid-animation.
      await page.addStyleTag({
        content:
          '[data-sonner-toaster]{display:none!important} *,*::before,*::after{transition:none!important}',
      });
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

test('WCAG 2.2 AA: settled toasts have sufficient contrast', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('lead@qaforge.dev');
  await page.getByLabel('Password').fill('qaforge-demo-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/acme/);
  await page.goto('/acme/p/PAY/test-cases/TC-0001');
  await page.getByText('Preconditions').waitFor();
  await page.getByRole('button', { name: /Review again|Review with AI/ }).click();
  await page.locator('[data-sonner-toast]').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(600); // let the enter animation finish
  const res = await new AxeBuilder({ page })
    .include('[data-sonner-toaster]')
    .withRules(['color-contrast'])
    .analyze();
  expect(res.violations).toEqual([]);
});
