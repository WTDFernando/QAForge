import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'qaforge-demo-1';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
}

test('redirects anonymous users to login and back', async ({ page }) => {
  await page.goto('/acme/settings/members');
  await expect(page).toHaveURL(/\/login\?next=%2Facme%2Fsettings%2Fmembers/);
  await page.getByLabel('Email').fill('owner@qaforge.dev');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/acme\/settings\/members$/);
  await expect(page.getByRole('cell', { name: /Olivia Owner/ })).toBeVisible();
});

test('shows a clear error for bad credentials', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('owner@qaforge.dev');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('form [role=alert]')).toContainText(/invalid/i);
});

test('QA lead creates a project in 3 steps via keyboard', async ({ page }) => {
  await login(page, 'lead@qaforge.dev');
  const name = `Checkout ${Date.now() % 100000}`;
  await page.keyboard.press('c'); // 1. shortcut opens dialog
  await page.getByLabel('Name').fill(name); // 2. type name (key is suggested)
  const key = `K${Date.now() % 100000}`;
  await page.getByLabel('Key').fill(key);
  await page.getByRole('button', { name: 'Create project' }).click(); // 3. create
  await expect(page).toHaveURL(new RegExp(`/acme/p/${key}$`));
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByText('created project').first()).toBeVisible();
});

test('command palette navigates', async ({ page }) => {
  await login(page, 'lead@qaforge.dev');
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByPlaceholder('Type a command or search…').fill('members');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/acme\/settings\/members$/);
});

test('viewer-level roles do not see create or invite actions', async ({ page }) => {
  await login(page, 'client@qaforge.dev');
  await expect(page.getByRole('button', { name: /New project/ })).toHaveCount(0);
  await page.goto('/acme/settings/members');
  await expect(page.getByRole('cell', { name: /Casey Client/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invite' })).toHaveCount(0);
});

test('owner invites a teammate and gets a shareable link', async ({ page }) => {
  await login(page, 'owner@qaforge.dev');
  await page.goto('/acme/settings/members');
  await page.getByRole('button', { name: 'Invite' }).click();
  await page.getByLabel('Email').fill(`new${Date.now()}@example.com`);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.locator('input[readonly]')).toHaveValue(/\/invite\/[0-9a-f-]{36}$/);
});
