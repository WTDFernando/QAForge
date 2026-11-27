import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Needs the seeded stack plus the worker (reports are built by it; AI uses the fake provider in CI).
async function signIn(page: Page, who: 'lead' | 'qa' | 'dev' | 'client') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(`${who}@qaforge.dev`);
  await page.getByLabel('Password').fill('qaforge-demo-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/acme/);
}
const BASE = '/acme/p/PAY';

async function axe(page: Page, name: string) {
  await page.addStyleTag({
    content:
      '[data-sonner-toaster]{display:none!important} *,*::before,*::after{transition:none!important}',
  });
  const res = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${name}: ${v.id} ${v.nodes[0]?.target.join(' ')} — ${v.help}`)).toEqual(
    [],
  );
}

test('a release that fails a blocking gate can’t be sent for approval', async ({ page }) => {
  await signIn(page, 'lead');
  await page.goto(`${BASE}/releases`);
  await page.getByRole('link', { name: /Spring release/ }).click();
  await expect(page.getByRole('heading', { name: /Spring release/ })).toBeVisible();
  const gates = page.getByRole('region', { name: 'Quality gates' });
  await expect(gates.getByText('Open bugs (blocker, critical)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request approval' })).toBeDisabled();
  await expect(
    page.getByText(/Approval can be requested when: \d+ blocking gates? not met/),
  ).toBeVisible();
});

test('plan, approve and ship a release end to end', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const version = `9.${Date.now() % 100000}.0`;
  await signIn(page, 'lead');
  await page.goto(`${BASE}/releases`);
  await page.getByRole('button', { name: 'New release' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New release' });
  await dialog.getByLabel('Name').fill('E2E hotfix');
  await dialog.getByLabel('Version').fill(version);
  await dialog.getByRole('button', { name: 'Create release' }).click();
  await expect(
    page.getByRole('heading', { name: new RegExp(`E2E hotfix ${version.replace(/\./g, '\\.')}`) }),
  ).toBeVisible();

  // Scope: one requirement.
  await page.getByRole('button', { name: 'Add requirements' }).click();
  const pick = page.getByRole('dialog', { name: 'Add requirements' });
  await pick.getByRole('checkbox').first().check();
  await pick.getByRole('button', { name: /^Add 1 requirements/ }).click();
  await expect(
    page.getByRole('tabpanel', { name: 'Requirements' }).getByRole('listitem'),
  ).toHaveCount(1);

  // Gates: keep only an advisory one so the release can be sent for approval.
  await page
    .getByRole('region', { name: 'Quality gates' })
    .getByRole('button', { name: 'Edit' })
    .click();
  const gd = page.getByRole('dialog', { name: 'Quality gates' });
  while ((await gd.getByRole('button', { name: /^Remove gate/ }).count()) > 0)
    await gd
      .getByRole('button', { name: /^Remove gate/ })
      .first()
      .click();
  await gd.getByRole('button', { name: 'Save gates' }).click();
  await expect(page.getByText('No quality gates.')).toBeVisible();

  // Approvers: the client.
  await page.getByRole('button', { name: 'Approvers' }).click();
  const ad = page.getByRole('dialog', { name: 'Approvers' });
  await ad.getByRole('checkbox', { name: 'Approver: Casey Client' }).check();
  await ad.getByRole('button', { name: 'Save approvers' }).click();
  await page.getByRole('button', { name: 'Request approval' }).click();
  await expect(page.getByText('Waiting for approval')).toBeVisible();
  const url = page.url();

  // The client approves from their own session.
  const ctx = await browser.newContext();
  const client = await ctx.newPage();
  await signIn(client, 'client');
  await client.goto(url);
  await client.getByRole('button', { name: 'Approve' }).click();
  await client
    .getByRole('dialog', { name: /Approve E2E hotfix/ })
    .getByLabel('Comment (optional)')
    .fill('Signed off in E2E');
  await client.getByRole('button', { name: 'Approve release' }).click();
  await expect(client.getByText('Approved', { exact: true }).first()).toBeVisible();
  await ctx.close();

  page.once('dialog', (d) => void d.accept());
  await page.reload();
  await page.getByRole('button', { name: 'Mark as released' }).click();
  await expect(page.getByText('Released', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('“Signed off in E2E”')).toBeVisible();
});

async function openShared(browser: Browser, url: string) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(url);
  return { p, ctx };
}

test('Go / No-Go report: numbers, AI summary, exports and a read-only link', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  await signIn(page, 'lead');
  await page.goto(`${BASE}/releases/REL-0001`);
  await page.getByRole('button', { name: 'Go / No-Go report' }).click();
  await expect(page).toHaveURL(/\/reports\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('status').getByText('No-go')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('region', { name: 'Summary' })).toBeVisible({ timeout: 60_000 });
  const downloads = page.getByRole('group', { name: 'Download' });
  await expect(downloads.getByRole('link')).toHaveCount(4, { timeout: 60_000 });
  const pdfHref = await downloads.getByRole('link', { name: 'PDF' }).getAttribute('href');
  const pdf = await page.request.get(pdfHref!);
  expect(pdf.ok()).toBe(true);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  await axe(page, 'report');

  await page.getByRole('button', { name: /Share link/ }).click();
  await page.getByRole('button', { name: 'Create link' }).click();
  const link = await page.getByLabel('Share link').inputValue();
  expect(link).toMatch(/\/share\/qaf_share_/);
  await page.getByRole('button', { name: 'Done' }).click();

  const shared = await openShared(browser, link);
  await expect(shared.p.getByText('Read-only shared report')).toBeVisible();
  await expect(shared.p.getByRole('heading', { level: 1 })).toContainText('Go / No-Go');
  await expect(shared.p.getByRole('group', { name: 'Download' }).getByRole('link')).toHaveCount(4);
  await axe(shared.p, 'shared report');
  await shared.ctx.close();

  await page.getByRole('button', { name: 'Shared' }).click();
  await page.getByRole('button', { name: 'Turn off link' }).click();
  const gone = await openShared(browser, link);
  await expect(gone.p.getByText('This link doesn’t work any more')).toBeVisible();
  await gone.ctx.close();
});

test('a bug summary for a period, and emailed reports for leads only', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, 'qa');
  await page.goto(`${BASE}/reports`);
  await page.getByRole('button', { name: 'New report' }).first().click();
  const d = page.getByRole('dialog', { name: 'New report' });
  await d.getByRole('radio', { name: /Bug summary/ }).click();
  await d.getByRole('button', { name: 'Create report' }).click();
  await expect(page.getByRole('heading', { name: 'By component' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText('Open now', { exact: true }).first()).toBeVisible();

  await page.goto(`${BASE}/reports`);
  await expect(page.getByText('Weekly bug summary')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Schedule' })).toHaveCount(0);
});

test('roles: developers can see releases but not plan them', async ({ page }) => {
  await signIn(page, 'dev');
  await page.goto(`${BASE}/releases`);
  await expect(page.getByRole('link', { name: /Spring release/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New release' })).toHaveCount(0);
  await page.goto(`${BASE}/releases/REL-0001`);
  await expect(page.getByRole('heading', { name: /Spring release/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request approval' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Go / No-Go report' })).toHaveCount(0);
});
