import { expect, test, type Page } from '@playwright/test';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function signIn(page: Page, who: 'lead' | 'qa' | 'dev') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(`${who}@qaforge.dev`);
  await page.getByLabel('Password').fill('qaforge-demo-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/acme/);
}

const untestedCount = async (page: Page) =>
  Number((await page.getByRole('tab', { name: /^Untested/ }).innerText()).replace(/\D/g, ''));

test('tester executes a run from the keyboard', async ({ page }) => {
  await signIn(page, 'qa');
  await page.goto('/acme/p/PAY/runs');
  await page.getByRole('link', { name: 'Release 2.4 regression' }).click();
  await expect(page.getByRole('heading', { name: 'Release 2.4 regression' })).toBeVisible();
  await page.getByRole('tab', { name: /^Untested/ }).click();
  const before = await untestedCount(page);
  const first = page.getByRole('list', { name: 'Cases' }).getByRole('button').first();
  await first.click();
  await expect(page.getByRole('group', { name: 'Result for step 1' })).toBeVisible();
  await page.keyboard.press('p');
  await expect.poll(() => untestedCount(page)).toBe(before - 1);
});

test('tester fails a step and reports a bug from it', async ({ page }) => {
  await signIn(page, 'qa');
  await page.goto('/acme/p/PAY/runs/RUN-0002');
  await page.getByRole('tab', { name: /^Untested/ }).click();
  await page.getByRole('list', { name: 'Cases' }).getByRole('button').first().click();
  const caseTitle = await page.getByRole('heading', { level: 2 }).innerText();
  await page.getByRole('button', { name: 'Step 1: Failed' }).click();
  await page.getByLabel('Actual result').fill('Nothing happens when I press the button');
  await page.getByRole('button', { name: 'Report bug from this step' }).click();
  const dialog = page.getByRole('dialog', { name: 'Report a bug' });
  await expect(dialog.getByLabel('Title')).toHaveValue(new RegExp(caseTitle.slice(0, 20)));
  await expect(dialog.getByLabel('Actual')).toHaveValue('Nothing happens when I press the button');
  await dialog.getByRole('button', { name: 'Create bug' }).click();
  await expect(page.getByText(/BUG-\d{4} reported/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Bugs from this result' })).toBeVisible();
});

test('lead plans a new run from a suite', async ({ page }) => {
  await signIn(page, 'lead');
  await page.goto('/acme/p/PAY/runs');
  await page.getByRole('button', { name: 'New run' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New test run' });
  await dialog.getByLabel('Name').fill('Checkout smoke (E2E)');
  await dialog.getByRole('combobox', { name: 'Suite' }).click();
  await page.getByRole('option').first().click();
  await dialog.getByRole('button', { name: 'Create run' }).click();
  await expect(page.getByRole('heading', { name: 'Checkout smoke (E2E)' })).toBeVisible();
  await expect(page.getByText(/pass rate · 0 of \d+ done/)).toBeVisible();
});

test('bug board: move a card with the keyboard', async ({ page }) => {
  await signIn(page, 'lead');
  await page.goto('/acme/p/PAY/bugs');
  const newCol = page.getByRole('region', { name: /^New, / });
  const card = newCol.getByRole('link', { name: /Typo in refund confirmation/ });
  await card.focus();
  await page.keyboard.press('2');
  await expect(page.getByText(/BUG-\d{4} moved to Triaged/)).toBeVisible();
  await expect(
    page.getByRole('region', { name: /^Triaged, / }).getByRole('link', { name: /Typo in refund/ }),
  ).toBeVisible();
});

test('quick report: Bug Agent drafts from a screenshot, tester files it', async ({ page }) => {
  await signIn(page, 'qa');
  await page.goto('/acme/p/PAY/bugs');
  await page.getByRole('button', { name: 'Quick report' }).click();
  const dialog = page.getByRole('dialog', { name: 'Quick report' });
  await dialog
    .locator('input[type=file]')
    .setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
  await dialog.getByLabel('What went wrong?').fill('Checkout total ignores the discount code');
  await dialog.getByRole('button', { name: 'Draft with Bug Agent' }).click();
  await expect(dialog.getByLabel('Title')).toHaveValue(/Checkout total ignores the discount code/, {
    timeout: 30000,
  });
  await expect(dialog.getByText(/confident/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Create bug' }).click();
  await expect(page.getByText(/BUG-\d{4} created/)).toBeVisible();
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByText('Drafted by Bug Agent')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Bug Agent notes' })).toBeVisible();
});

test('bug workflow and notifications', async ({ page }) => {
  await signIn(page, 'dev');
  const bell = page.getByRole('button', { name: /^Notifications, \d+ unread/ });
  await expect(bell).toBeVisible();
  await bell.click();
  await page
    .getByRole('button', { name: /was assigned to you/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/bugs\/BUG-\d{4}$/);
  await page.goto('/acme/p/PAY/bugs/BUG-0008');
  await page.getByRole('button', { name: 'Ready for retest' }).click();
  await expect(page.getByText('BUG-0008 is now ready for retest')).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Workflow' }).getByText('Ready for retest'),
  ).toHaveAttribute('aria-current', 'step');
});
