/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { test, expect } from '../fixtures';
import { waitForSettle } from '../helpers';

test.describe('Pipeline Timeline E2E', () => {
  test('renders step statuses, clicks Resume button to resume from failed step, and re-run invalidates downstream steps', async ({
    page,
  }) => {
    await page.waitForSelector('body', { state: 'visible' });
    await waitForSettle(page);

    // 1. Seed a pipeline run with a failed step into localStorage
    await page.evaluate(() => {
      const testRun = {
        id: 'run-e2e-pipeline-1',
        projectId: 'proj-e2e',
        name: 'Automated Video Pipeline',
        status: 'failed',
        createdAt: Date.now() - 3600000,
        updatedAt: Date.now() - 600000,
        steps: [
          {
            id: 'step-0',
            runId: 'run-e2e-pipeline-1',
            stepIndex: 0,
            name: 'Script Generation',
            status: 'completed',
            artifactPaths: ['./script.md'],
            contentHash: 'hash-0000-aaaa',
            updatedAt: Date.now() - 3500000,
          },
          {
            id: 'step-1',
            runId: 'run-e2e-pipeline-1',
            stepIndex: 1,
            name: 'Voiceover Synthesis',
            status: 'completed',
            artifactPaths: ['./voice.mp3'],
            contentHash: 'hash-1111-bbbb',
            updatedAt: Date.now() - 2500000,
          },
          {
            id: 'step-2',
            runId: 'run-e2e-pipeline-1',
            stepIndex: 2,
            name: 'Video Composition',
            status: 'failed',
            artifactPaths: ['./output.mp4'],
            error: 'Backend killed mid-step: GPU connection timed out',
            updatedAt: Date.now() - 600000,
          },
          {
            id: 'step-3',
            runId: 'run-e2e-pipeline-1',
            stepIndex: 3,
            name: 'Social Media Publishing',
            status: 'pending',
            artifactPaths: [],
            updatedAt: Date.now() - 600000,
          },
        ],
      };

      localStorage.setItem('aionui:active-pipeline-run', JSON.stringify(testRun));
      // Navigate to pipeline page
      window.location.hash = '#/pipeline';
    });

    await waitForSettle(page);

    // 2. Verify Pipeline Timeline is rendered
    const timeline = page.locator('[data-testid="pipeline-run-timeline"]');
    await expect(timeline).toBeVisible();

    // 3. Verify step statuses before resume
    const step0Status = page.locator('[data-testid="step-status-0"]');
    const step1Status = page.locator('[data-testid="step-status-1"]');
    const step2Status = page.locator('[data-testid="step-status-2"]');
    const step2Error = page.locator('[data-testid="step-error-2"]');

    await expect(step0Status).toContainText('Completed');
    await expect(step1Status).toContainText('Completed');
    await expect(step2Status).toContainText('Failed');
    await expect(step2Error).toContainText('Backend killed mid-step');

    // 4. Verify Resume button is enabled and click it
    const resumeBtn = page.locator('[data-testid="btn-resume-run"]');
    await expect(resumeBtn).toBeVisible();
    await expect(resumeBtn).toBeEnabled();

    await resumeBtn.click();
    await waitForSettle(page);

    // 5. Confirm completed steps were skipped and failed step 2 is now completed
    await expect(step0Status).toContainText('Completed');
    await expect(step1Status).toContainText('Completed');
    await expect(step2Status).toContainText('Completed');
    await expect(step2Error).not.toBeVisible();

    // 6. Test Re-run button on step 1: invalidates step 1 and downstream
    const rerunStep1Btn = page.locator('[data-testid="btn-rerun-step-1"]');
    await expect(rerunStep1Btn).toBeVisible();
    await rerunStep1Btn.click();
    await waitForSettle(page);

    // Step 0 remains completed, Step 1 & Step 2 reset to Pending
    await expect(step0Status).toContainText('Completed');
    await expect(step1Status).toContainText('Pending');
    await expect(step2Status).toContainText('Pending');
  });
});
