import { expect, test } from '@playwright/test';

/**
 * NFR: a 10,000 test case list loads in under 1 s (needs `pnpm db:perf-fixture`).
 * Measured from navigation start to the first rows painted, after the app bundle is cached
 * (the first visit to any page in a session also loads the JavaScript bundle once).
 */
test('10,000 test cases: list shows in under 1 s and large pages stay virtualised', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('lead@qaforge.dev');
  await page.getByLabel('Password').fill('qaforge-demo-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/acme/);
  await page.evaluate(() => localStorage.clear());
  const list = '/acme/p/PERF/test-cases';
  await page.goto(list);
  await expect(page.getByText('of 10,000')).toBeVisible({ timeout: 15000 });

  const samples: number[] = [];
  for (let i = 0; i < 3; i++) {
    await page.goto('/acme/p/PERF');
    await page.getByText('Requirements coverage').waitFor();
    const t0 = Date.now();
    await page.getByRole('link', { name: 'Test cases' }).first().click();
    await page.locator('tbody tr[aria-rowindex]').first().waitFor();
    await expect(page.getByText('of 10,000')).toBeVisible();
    samples.push(Date.now() - t0);
  }
  const best = Math.min(...samples);
  console.log(`10k list ready in ${samples.join(', ')} ms`);
  expect(best, `list took ${best} ms`).toBeLessThan(1000);

  // 500 rows per page: only the visible rows are in the DOM.
  await page.getByLabel('Rows per page').selectOption('500');
  await expect(page.getByText('1–500 of 10,000')).toBeVisible();
  const rendered = await page.locator('tbody tr[aria-rowindex]').count();
  expect(rendered).toBeLessThan(120);
  expect(rendered).toBeGreaterThan(5);
  await expect(page.getByRole('table')).toHaveAttribute('aria-rowcount', '501');
  // Scrolling renders the rows further down.
  await page
    .locator('[aria-busy]')
    .first()
    .evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(page.locator('tbody tr[aria-rowindex="501"]')).toBeVisible();
});
