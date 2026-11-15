/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  OrgFolderTools,
  checkRiskyCommand,
  getMinimalEnv,
} from '../../../packages/desktop/src/process/services/org/folderTools';
import { setMasterRoot, resetMasterRoot } from '../../../packages/desktop/src/process/services/org/orgScope';
import {
  issueCommandApprovalToken,
  consumeCommandApprovalToken,
  _resetApprovalTokens,
} from '../../../packages/desktop/src/process/services/org/orgApproval';
import {
  getShellExecutionLogs,
  _resetShellExecutionLogs,
} from '../../../packages/desktop/src/process/services/org/orgTelemetry';

describe('Phase 3: Shell Hardening, Sandboxing, and Main Process Approval', () => {
  let tempRoot: string;
  let workspaceDir: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-shell-test-'));
    workspaceDir = path.join(tempRoot, 'org_workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });
    setMasterRoot(workspaceDir);
    _resetApprovalTokens();
    _resetShellExecutionLogs();
  });

  afterEach(() => {
    resetMasterRoot();
    _resetApprovalTokens();
    _resetShellExecutionLogs();
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  });

  describe('checkRiskyCommand patterns', () => {
    it('detects directory traversal commands like "cat ../../x"', () => {
      expect(checkRiskyCommand('cat ../../secret.txt').isRisky).toBe(true);
      expect(checkRiskyCommand('type ..\\secret.txt').isRisky).toBe(true);
      expect(checkRiskyCommand('ls sub/../../evil').isRisky).toBe(true);
    });

    it('detects home directory and environment expansions (~, $HOME, %USERPROFILE%)', () => {
      expect(checkRiskyCommand('cat ~/secrets.txt').isRisky).toBe(true);
      expect(checkRiskyCommand('echo $HOME/secret').isRisky).toBe(true);
      expect(checkRiskyCommand('type %USERPROFILE%\\secret').isRisky).toBe(true);
    });

    it('detects absolute paths outside cwd', () => {
      if (process.platform === 'win32') {
        expect(checkRiskyCommand('type C:\\Windows\\System32\\drivers\\etc\\hosts', workspaceDir).isRisky).toBe(true);
        expect(checkRiskyCommand('dir C:\\', workspaceDir).isRisky).toBe(true);
      } else {
        expect(checkRiskyCommand('cat /etc/passwd', workspaceDir).isRisky).toBe(true);
        expect(checkRiskyCommand('cat /var/log/syslog', workspaceDir).isRisky).toBe(true);
      }
    });

    it('detects cd attempts out of workspace', () => {
      expect(checkRiskyCommand('cd ..').isRisky).toBe(true);
      expect(checkRiskyCommand('cd /').isRisky).toBe(true);
      expect(checkRiskyCommand('cd C:\\').isRisky).toBe(true);
      expect(checkRiskyCommand('cd ~').isRisky).toBe(true);
    });

    it('detects dangerous shell primitives and tools (ssh, scp, powershell -enc, reg, crontab, schtasks)', () => {
      expect(checkRiskyCommand('powershell -enc aGVsbG8=').isRisky).toBe(true);
      expect(checkRiskyCommand('pwsh -EncodedCommand aGVsbG8=').isRisky).toBe(true);
      expect(checkRiskyCommand('iex "Get-Process"').isRisky).toBe(true);
      expect(checkRiskyCommand('Invoke-Expression "calc"').isRisky).toBe(true);
      expect(checkRiskyCommand('ssh user@host').isRisky).toBe(true);
      expect(checkRiskyCommand('scp file user@host:/tmp').isRisky).toBe(true);
      expect(checkRiskyCommand('reg add HKLM\\Software\\Test').isRisky).toBe(true);
      expect(checkRiskyCommand('schtasks /create /tn "evil"').isRisky).toBe(true);
      expect(checkRiskyCommand('crontab -r').isRisky).toBe(true);
      expect(checkRiskyCommand('Remove-Item -Recurse -Force sub').isRisky).toBe(true);
      expect(checkRiskyCommand('del /s *.txt').isRisky).toBe(true);
      expect(checkRiskyCommand('rmdir /s /q test').isRisky).toBe(true);
      expect(checkRiskyCommand('chmod -R 777 /tmp').isRisky).toBe(true);
    });

    it('permits safe ordinary development commands', () => {
      expect(checkRiskyCommand('npm test').isRisky).toBe(false);
      expect(checkRiskyCommand('git status').isRisky).toBe(false);
      expect(checkRiskyCommand('node -v').isRisky).toBe(false);
      expect(checkRiskyCommand('bun run build').isRisky).toBe(false);
    });
  });

  describe('Approval token enforcement', () => {
    it('malicious caller: requiresApproval: false does NOT bypass check', async () => {
      const riskyCmd = 'rm -rf evil_folder';
      // Passing requiresApproval: false used to bypass; now it must be ignored and fail closed
      await expect(
        OrgFolderTools.runShell(riskyCmd, workspaceDir, workspaceDir, { requiresApproval: false } as any)
      ).rejects.toThrow(/Blocked risky command requiring manual approval/);
    });

    it('risky command without token is rejected', async () => {
      const riskyCmd = 'git push origin main --force';
      await expect(OrgFolderTools.runShell(riskyCmd, workspaceDir, workspaceDir)).rejects.toThrow(
        /Blocked risky command requiring manual approval/
      );
    });

    it('valid token minted by main process allows execution, then immediately expires (single use)', async () => {
      const riskyCmd =
        process.platform === 'win32'
          ? 'Write-Output "approved"; iex "Write-Output ok"'
          : 'echo "approved"; iex "echo ok"';
      const token = issueCommandApprovalToken(riskyCmd, workspaceDir);

      // First call with valid token succeeds
      const result = await OrgFolderTools.runShell(riskyCmd, workspaceDir, workspaceDir, {
        approvalToken: token,
      });
      expect(result.exitCode).toBe(0);

      // Second call reusing the same token MUST be refused (replay attack prevented)
      await expect(
        OrgFolderTools.runShell(riskyCmd, workspaceDir, workspaceDir, {
          approvalToken: token,
        })
      ).rejects.toThrow(/Blocked risky command requiring manual approval/);
    });

    it('token is strictly bound to command string and cwd', async () => {
      const cmdA = 'git reset --hard HEAD~1';
      const cmdB = 'git push origin main --force';
      const token = issueCommandApprovalToken(cmdA, workspaceDir);

      // Mismatched command: using cmdA's token for cmdB fails
      expect(consumeCommandApprovalToken(token, cmdB, workspaceDir)).toBe(false);

      // Re-issue token for cwdA
      const token2 = issueCommandApprovalToken(cmdA, workspaceDir);
      const otherCwd = path.join(tempRoot, 'other_dir');
      // Mismatched cwd fails
      expect(consumeCommandApprovalToken(token2, cmdA, otherCwd)).toBe(false);
    });
  });

  describe('Minimal environment sanitization', () => {
    it('strips API keys, secrets, tokens, passwords and process.env leaking', () => {
      // Temporarily inject dirty env vars into main process env
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-12345';
      process.env.OPENAI_API_SECRET = 'sk-open-test-99999';
      process.env.AWS_SECRET_ACCESS_KEY = 'secret-key-xyz';
      process.env.DATABASE_PASSWORD = 'super-secret-pw';
      process.env.GITHUB_TOKEN = 'ghp_token123';
      process.env.CUSTOM_CREDENTIAL = 'my-cred';

      const cleanEnv = getMinimalEnv(workspaceDir);

      expect(cleanEnv.ANTHROPIC_API_KEY).toBeUndefined();
      expect(cleanEnv.OPENAI_API_SECRET).toBeUndefined();
      expect(cleanEnv.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(cleanEnv.DATABASE_PASSWORD).toBeUndefined();
      expect(cleanEnv.GITHUB_TOKEN).toBeUndefined();
      expect(cleanEnv.CUSTOM_CREDENTIAL).toBeUndefined();

      // Confines HOME and USERPROFILE to cwd
      expect(cleanEnv.HOME).toBe(workspaceDir);
      expect(cleanEnv.USERPROFILE).toBe(workspaceDir);

      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_SECRET;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      delete process.env.DATABASE_PASSWORD;
      delete process.env.GITHUB_TOKEN;
      delete process.env.CUSTOM_CREDENTIAL;
    });
  });

  describe('Output capping and process timeout', () => {
    it('caps large output at 1 MB and appends truncation marker', async () => {
      // Command that produces > 1 MB of text
      const cmd =
        process.platform === 'win32'
          ? 'powershell -NoProfile -Command "1..25000 | ForEach-Object { Write-Output \'01234567890123456789012345678901234567890123456789\' }"'
          : 'python3 -c "print(\'A\' * 1500000)" 2>/dev/null || node -e "console.log(\'A\'.repeat(1500000))"';

      const res = await OrgFolderTools.runShell(cmd, workspaceDir, workspaceDir, { timeoutMs: 15000 });
      expect(res.stdout.length).toBeLessThanOrEqual(1024 * 1024 + 100);
      expect(res.stdout).toContain('[TRUNCATED: Output exceeded 1 MB limit]');
    });

    it('kills process on timeout and logs telemetry', async () => {
      const sleepCmd = process.platform === 'win32' ? 'Start-Sleep -Seconds 10' : 'sleep 10';

      const res = await OrgFolderTools.runShell(sleepCmd, workspaceDir, workspaceDir, { timeoutMs: 1200 });
      expect(res.timedOut).toBe(true);

      const logs = getShellExecutionLogs();
      expect(logs.length).toBeGreaterThan(0);
      const last = logs[logs.length - 1];
      expect(last.command).toBe(sleepCmd);
      expect(last.timedOut).toBe(true);
    });
  });
});
