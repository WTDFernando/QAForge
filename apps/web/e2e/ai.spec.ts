import { expect, test, type Page } from '@playwright/test';

// Runs against a stack started with QAFORGE_AI_PROVIDER=fake (deterministic, no API key needed).
const PAY = '/acme/p/PAY';
const uid = () => `${Date.now() % 1_000_000}`;

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('qaforge-demo-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/acme/);
}

test('Requirement Agent turns an uploaded document into draft requirements', async ({ page }) => {
  await login(page, 'lead@qaforge.dev');
  await page.goto(`${PAY}/requirements`);
  // Wait for hydration so the file input's change handler is attached.
  await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible();
  const name = `loyalty-${uid()}.md`;
  const feature = `Members earn loyalty points on every paid order ${uid()}`;
  await page.getByLabel('Upload requirement documents').setInputFiles({
    name,
    mimeType: 'text/markdown',
    buffer: Buffer.from(`# Loyalty\n- ${feature}\n`),
  });
  const row = page.getByRole('listitem').filter({ hasText: name });
  await row.getByRole('button', { name: 'Analyze' }).click();
  await expect(row.getByText('Analyzed')).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Requirements ready for review')).toBeVisible();
  await expect(page.getByRole('tree').getByRole('link', { name: feature })).toBeVisible();
  await row.getByText(/AI summary/).click();
  await expect(row.getByText('Which user roles does this apply to?')).toBeVisible();
});

test('generate test cases, then approve the drafts from the review queue', async ({ page }) => {
  await login(page, 'lead@qaforge.dev');
  await page.goto(`${PAY}/requirements`);
  await page.getByRole('tree').getByRole('link', { name: 'Apple Pay on Safari' }).click();
  await page.getByRole('button', { name: 'Generate test cases' }).click();
  await expect(page.getByText('Test case drafts ready for review')).toBeVisible({ timeout: 20000 });
  await page.getByRole('tab', { name: /Test cases/ }).click();
  await expect(
    page.getByRole('link', { name: /Apple Pay on Safari – happy path/ }).first(),
  ).toBeVisible();

  await page.goto(`${PAY}/test-cases?view=review`);
  const row = page.getByRole('row').filter({ hasText: 'Apple Pay on Safari – happy path' }).first();
  await expect(row.getByText(/AI · 82%/)).toBeVisible();
  await row.getByRole('checkbox').check();
  await page
    .getByRole('toolbar', { name: 'Bulk actions' })
    .getByRole('button', { name: 'Approve' })
    .click();
  await expect(page.getByText('Approved 1 test case')).toBeVisible();
});

test('Test Case Reviewer suggestions and requirement clarity assessment', async ({ page }) => {
  await login(page, 'lead@qaforge.dev');
  await page.goto(`${PAY}/test-cases/TC-0001`);
  await page.getByRole('button', { name: /Review with AI|Review again/ }).click();
  await expect(page.getByText('Needs changes')).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByText('State the exact message or state the tester should see.', { exact: false }),
  ).toBeVisible();

  await page.goto(`${PAY}/requirements`);
  await page.getByRole('tree').getByRole('link', { name: 'Google Pay on Chrome' }).click();
  await page.getByRole('button', { name: /Assess clarity|Re-assess/ }).click();
  await expect(page.getByText(/Clarity \d+\/100/)).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Questions for the client')).toBeVisible();
});

test('QA Copilot answers from project data', async ({ page }) => {
  await login(page, 'lead@qaforge.dev');
  await page.goto(PAY);
  await page.getByRole('button', { name: /Copilot/ }).click();
  const panel = page.getByRole('dialog', { name: /QA Copilot/ });
  await panel
    .getByRole('button', { name: 'Which high-priority requirements have no tests?' })
    .click();
  await expect(panel.getByText('Reading project stats')).toBeVisible();
  await expect(panel.getByText(/requirements; \d+ of them have test cases/)).toBeVisible();
});

test('admins see AI settings and usage; engineers see a read-only view', async ({ page }) => {
  await login(page, 'owner@qaforge.dev');
  await page.goto('/acme/settings/ai');
  await expect(page.getByLabel('Model')).toBeVisible();
  await expect(page.getByText('Usage this month')).toBeVisible();
  await page.getByLabel('Monthly budget (USD)').fill('50');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('AI settings saved')).toBeVisible();
  await page.getByLabel('Monthly budget (USD)').fill('');
  await page.getByRole('button', { name: 'Save' }).click();

  await page.context().clearCookies();
  await login(page, 'qa@qaforge.dev');
  await page.goto('/acme/settings/ai');
  await expect(
    page.getByText(/Only Owners and Admins can change these settings|Ask an Owner or Admin/),
  ).toBeVisible();
  await expect(page.getByLabel('Model')).toHaveCount(0);
});
