/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { test, expect } from '../fixtures';
import { waitForSettle } from '../helpers';

test.describe('Approvals Inbox E2E', () => {
  test('lists items from two different teams, batch approve works, and badge count updates', async ({ page }) => {
    await page.waitForSelector('body', { state: 'visible' });
    await waitForSettle(page);

    // 1. Seed two pending confirmation items from two different teams into localStorage
    await page.evaluate(() => {
      const items = [
        {
          id: 'conf-team-alpha',
          callId: 'call-alpha-1',
          conversationId: 'conv-alpha-1',
          teamId: 'team-alpha',
          teamName: 'Team Alpha',
          agentName: 'Alpha Agent',
          title: 'Deploy Microservice Alpha',
          command: 'kubectl apply -f alpha.yaml',
          action: 'shell_exec',
          options: [
            { label: 'Approve', value: 'proceed_once' },
            { label: 'Deny', value: 'cancel' },
          ],
          createdAt: Date.now(),
        },
        {
          id: 'conf-team-beta',
          callId: 'call-beta-1',
          conversationId: 'conv-beta-1',
          teamId: 'team-beta',
          teamName: 'Team Beta',
          agentName: 'Beta Agent',
          title: 'Run Database Migration Beta',
          command: 'prisma migrate deploy',
          action: 'shell_exec',
          options: [
            { label: 'Approve', value: 'proceed_once' },
            { label: 'Deny', value: 'cancel' },
          ],
          createdAt: Date.now(),
        },
      ];
      localStorage.setItem('aionui:approvals-inbox', JSON.stringify(items));
      // Dispatch storage event so live hooks update
      window.dispatchEvent(new Event('storage'));
    });

    // 2. Reload or navigate to trigger state refresh
    await page.goto(page.url());
    await waitForSettle(page);

    // 3. Verify sidebar badge count shows 2
    const badge = page.locator('[data-testid="sider-tab-badge-approvals"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('2');

    // 4. Click Approvals tab to navigate to the approvals inbox
    const approvalsTab = page.locator('[data-testid="sider-tab-approvals"]');
    await approvalsTab.click();
    await waitForSettle(page);

    // 5. Verify Approvals Inbox page is rendered
    const inboxPage = page.locator('[data-testid="approvals-inbox-page"]');
    await expect(inboxPage).toBeVisible();

    // 6. Verify items from both teams are displayed
    const itemAlpha = page.locator('[data-testid="approval-item-conf-team-alpha"]');
    const itemBeta = page.locator('[data-testid="approval-item-conf-team-beta"]');
    await expect(itemAlpha).toBeVisible();
    await expect(itemBeta).toBeVisible();
    await expect(itemAlpha).toContainText('Team Alpha');
    await expect(itemAlpha).toContainText('Deploy Microservice Alpha');
    await expect(itemBeta).toContainText('Team Beta');
    await expect(itemBeta).toContainText('Run Database Migration Beta');

    // 7. Select All items using checkbox
    const selectAllCheckbox = page.locator('[data-testid="checkbox-select-all"] input[type="checkbox"]');
    await selectAllCheckbox.check();

    // 8. Click Batch Approve button
    const batchApproveBtn = page.locator('[data-testid="btn-batch-approve"]');
    await expect(batchApproveBtn).toBeVisible();
    await batchApproveBtn.click();
    await waitForSettle(page);

    // 9. Verify items are removed and empty state is displayed
    await expect(itemAlpha).not.toBeVisible();
    await expect(itemBeta).not.toBeVisible();

    // 10. Verify badge count is removed/updated
    await expect(badge).not.toBeVisible();
  });
});
