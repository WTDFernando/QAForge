import { expect, test, type Page } from '@playwright/test';

// Needs the seeded stack plus the worker (UI runs execute Playwright in the process sandbox).
async function signIn(page: Page, who: 'lead' | 'qa' | 'dev' | 'client') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(`${who}@qaforge.dev`);
  await page.getByLabel('Password').fill('qaforge-demo-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/acme/);
}

const BASE = '/acme/p/PAY/automation';

test('engineer sends an API request and sees assertion results', async ({ page }) => {
  await signIn(page, 'qa');
  await page.goto(BASE);
  await page
    .getByRole('tree', { name: 'Requests' })
    .getByRole('button', { name: /Health check/ })
    .click();
  await expect(page.getByLabel('URL')).toHaveValue('{{api}}/health');
  await page.getByRole('button', { name: 'Send' }).click();
  const response = page.getByRole('region', { name: 'Response' });
  await expect(response.getByText('200 OK')).toBeVisible();
  await expect(response.getByText('4 / 4 assertions passed')).toBeVisible();
  // The extract rule chains a variable into the next request.
  await expect(page.getByText('{{dbStatus}}')).toBeVisible();
});

test('engineer imports a cURL command as a new collection', async ({ page }) => {
  await signIn(page, 'qa');
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Import' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Import requests' });
  await dialog
    .getByLabel('File contents')
    .fill(`curl 'http://localhost:4000/health?e2e=${Date.now()}' -H 'accept: application/json'`);
  await expect(dialog.getByRole('radio', { name: /cURL/ })).toHaveAttribute('aria-checked', 'true');
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText(/Imported 1 request into/)).toBeVisible();
  await expect(dialog).toBeHidden();
});

test('lead reviews and approves the AI locator fix', async ({ page }) => {
  await signIn(page, 'lead');
  await page.goto(`${BASE}/tests`);
  await page.getByRole('button', { name: /checkout\/new-card\.spec\.ts/ }).click();
  const fix = page.getByRole('region', { name: 'Suggested fix' });
  await expect(fix.getByText('Automation Agent suggests a fix')).toBeVisible();
  await expect(fix.getByText(/renamed to "Place order"/)).toBeVisible();
  await fix.getByRole('button', { name: 'Approve fix' }).click();
  await expect(page.getByText('Fix applied as a new version')).toBeVisible();
  await expect(fix).toBeHidden();
  await expect(page.getByText(/^v2$/)).toBeVisible();
});

test('engineer runs a UI test in the sandbox and sees it pass', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, 'qa');
  await page.goto(`${BASE}/tests`);
  await page.getByRole('combobox', { name: 'Environment for runs' }).click();
  await page.getByRole('option', { name: 'Local' }).click();
  await page.getByRole('button', { name: /auth\/sign-in\.spec\.ts/ }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page).toHaveURL(/\/automation\/runs\/AUT-\d+/);
  await expect(page.getByRole('heading', { level: 1 }).getByText(/AUT-\d+/)).toBeVisible();
  await expect(page.getByText('wrong password shows an error')).toBeVisible({ timeout: 150_000 });
  await expect(page.getByRole('main').getByText('Passed').first()).toBeVisible();
});

test('a failed result opens a pre-filled bug report and shows the AI analysis', async ({
  page,
}) => {
  await signIn(page, 'qa');
  await page.goto(`${BASE}/runs`);
  await page.getByRole('link', { name: 'AUT-0001' }).click();
  await expect(
    page.getByRole('region', { name: 'AI analysis' }).getByText('Test problem'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Report bug' }).click();
  const dialog = page.getByRole('dialog', { name: 'Report a bug' });
  await expect(dialog.getByLabel('Title')).toHaveValue(
    /checkout\/new-card\.spec\.ts fails in AUT-0001/,
  );
  await expect(dialog.getByLabel('Actual')).toHaveValue(/Timeout 30000ms exceeded/);
});

test('lead creates a CI token once and the webhook starts a run', async ({ page, request }) => {
  await signIn(page, 'lead');
  await page.goto(`${BASE}/ci`);
  await page.getByLabel('Token name').fill(`E2E ${Date.now()}`);
  await page.getByRole('button', { name: 'Create token' }).click();
  const shown = page.getByLabel('New token', { exact: true });
  await expect(shown).toContainText('qaf_ci_');
  const token = (await shown.innerText()).trim();
  await expect(page.getByLabel('GitHub Actions workflow', { exact: true })).toContainText(
    '/v1/hooks/automation',
  );
  await page.getByRole('button', { name: 'I’ve stored it' }).click();
  await expect(page.getByLabel('New token', { exact: true })).toBeHidden();

  const res = await request.post('/v1/hooks/automation', {
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': `e2e-${Date.now()}` },
    data: { selection: { kind: 'collections', collectionIds: [] }, environment: 'Local' },
  });
  // An empty selection is rejected: tokens can't start meaningless runs.
  expect(res.status()).toBe(400);
  const ok = await request.post('/v1/hooks/automation', {
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': `e2e-ok-${Date.now()}` },
    data: { selection: { kind: 'tags', tags: ['smoke'] }, environment: 'Local', build: 'e2e' },
  });
  expect(ok.status()).toBe(202);
  const body = (await ok.json()) as { ref: string; url: string };
  expect(body.ref).toMatch(/^AUT-\d+$/);
  const status = await request.get(`/v1/hooks/automation/runs/${body.ref}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(status.ok()).toBe(true);
});

test('roles: a client can look but not change, and only leads manage CI tokens', async ({
  page,
}) => {
  await signIn(page, 'client');
  await page.goto(`${BASE}/tests`);
  await expect(page.getByRole('button', { name: /auth\/sign-in\.spec\.ts/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New test' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toHaveCount(0);
  await page.goto(`${BASE}/ci`);
  await expect(page.getByText('QA Leads and Admins manage CI tokens')).toBeVisible();
});
