import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'qaforge-demo-1';
const PAY = '/acme/p/PAY';
const uid = () => `${Date.now() % 1_000_000}`;

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/acme/);
}

test('dashboard shows real coverage and the attention list', async ({ page }) => {
  await login(page, 'lead@qaforge.dev');
  await page.goto(PAY);
  await expect(page.getByText('Requirements coverage')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What needs my attention' })).toBeVisible();
  await expect(page.getByText('Test runs arrive in Phase 4.')).toBeVisible();
});

test('write a requirement with acceptance criteria, then add a linked test case', async ({
  page,
}) => {
  await login(page, 'qa@qaforge.dev');
  await page.goto(`${PAY}/requirements`);
  await expect(page.getByRole('tree', { name: 'Requirements' })).toBeVisible();
  const title = `Guest checkout ${uid()}`;
  await page.keyboard.press('c');
  await page.getByLabel('Title').fill(title);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(title) })).toBeVisible();

  await page.getByLabel('New acceptance criterion').fill('Guest can pay without an account');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('AC1')).toBeVisible();

  const editor = page.getByRole('textbox', { name: 'Description' });
  await editor.click();
  await editor.pressSequentially('Shoppers may skip sign-up.');
  await page.getByLabel('New acceptance criterion').click(); // blur saves
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(
    page.getByText(/changed .*description|changed .*acceptanceCriteria/).first(),
  ).toBeVisible();

  await page.getByRole('tab', { name: /Test cases/ }).click();
  await page.getByRole('button', { name: 'New test case' }).click();
  await expect(page).toHaveURL(/\/test-cases\/TC-\d{4}$/);
  await expect(page.getByLabel('Title')).toHaveValue(title);
  await expect(page.getByRole('link', { name: title })).toBeVisible(); // linked requirement in sidebar
});

test('edit steps, save a version, submit for review and approve', async ({ page }) => {
  await login(page, 'lead@qaforge.dev');
  await page.goto(`${PAY}/test-cases`);
  await page.getByRole('button', { name: 'New test case' }).click();
  const title = `Coupon applies discount ${uid()}`;
  await page.getByLabel('Title').fill(title);
  await page.getByRole('button', { name: 'Create and edit' }).click();
  await expect(page).toHaveURL(/\/test-cases\/TC-\d{4}$/);

  await page.getByRole('button', { name: 'Add step' }).click();
  await page.getByLabel('Step 1 action').fill('Apply coupon SAVE10');
  await page.getByLabel('Step 1 expected result').fill('Total drops by 10%');
  await expect(page.getByRole('region', { name: 'Unsaved changes' })).toBeVisible();
  await page.getByLabel('Change note').fill('Added coupon step');
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByText('Saved as version 2')).toBeVisible();

  await page.getByRole('button', { name: 'Submit for review' }).click();
  const header = page.locator('.sticky').first();
  await expect(header.getByText('In review', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(header.getByText('Approved', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByText('“Added coupon step”')).toBeVisible();
});

test('list: filter, review queue, bulk priority with undo, export', async ({ page }) => {
  await login(page, 'lead@qaforge.dev');
  await page.goto(`${PAY}/test-cases`);
  await expect(page.getByRole('link', { name: 'Pay with a valid Visa card' })).toBeVisible();

  await page.getByRole('button', { name: 'Review queue' }).click();
  await expect(page.getByRole('link', { name: 'Pay with a valid Visa card' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Review queue' }).click();

  await page.getByLabel('Search test cases').fill('TC-0001');
  await expect(page.getByRole('row')).toHaveCount(2);
  await page.getByLabel('Search test cases').fill('');

  await page.getByLabel('Select TC-0001').check();
  await page.getByLabel('Select TC-0002').check();
  const bar = page.getByRole('toolbar', { name: 'Bulk actions' });
  await expect(bar.getByText('2 selected')).toBeVisible();
  await bar.getByRole('button', { name: 'Priority' }).click();
  await page.getByRole('menuitem', { name: 'Low' }).click();
  await expect(page.getByText('2 test cases set to Low')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Undone')).toBeVisible();
  await expect(page.getByRole('row', { name: /TC-0001/ }).getByText('Critical')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: 'CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^test-cases-.*\.csv$/);
});

test('upload a requirement document', async ({ page }) => {
  await login(page, 'qa@qaforge.dev');
  await page.goto(`${PAY}/requirements`);
  // Wait for hydration so the file input's change handler is attached.
  await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible();
  const name = `spec-${uid()}.md`;
  await page.getByLabel('Upload requirement documents').setInputFiles({
    name,
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Spec\nUsers can pay.'),
  });
  await expect(page.getByRole('link', { name })).toBeVisible();
});

test('client can approve but not edit', async ({ page }) => {
  await login(page, 'client@qaforge.dev');
  await page.goto(`${PAY}/test-cases/TC-0003`);
  await expect(page.getByLabel('Title')).toHaveAttribute('readonly', '');
  await expect(page.getByRole('button', { name: 'Add step' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New test case' })).toHaveCount(0);
});

test('project settings: environment secrets stay write-only', async ({ page }) => {
  await login(page, 'lead@qaforge.dev');
  await page.goto(`${PAY}/settings`);
  await page.getByRole('button', { name: 'Add' }).first().click();
  const name = `QA-${uid()}`;
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Base URL').fill('https://qa.shop.example');
  await dialog.getByRole('button', { name: 'Add' }).nth(1).click();
  await dialog.getByLabel('Secret 1 name').fill('ADMIN_PASSWORD');
  await dialog.getByLabel('Secret 1 value').fill('hunter2-secret');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Environment created')).toBeVisible();
  const row = page.getByRole('listitem').filter({ hasText: name });
  await expect(row.getByText('1 secrets')).toBeVisible();
  await row.getByRole('button', { name: `Edit ${name}` }).click();
  await expect(page.getByText('ADMIN_PASSWORD')).toBeVisible();
  await expect(page.getByText('hunter2-secret')).toHaveCount(0);
});

test('tablet width uses the slide-out navigation', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1100 });
  await login(page, 'lead@qaforge.dev');
  await page.goto(`${PAY}/test-cases`);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Requirements' }).click();
  await expect(page).toHaveURL(/\/requirements$/);
});
