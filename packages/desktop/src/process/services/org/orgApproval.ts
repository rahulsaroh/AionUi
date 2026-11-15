/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';

export interface CommandApprovalToken {
  token: string;
  command: string;
  cwd: string;
  createdAt: number;
  expiresAt: number;
}

export interface FileApprovalToken {
  token: string;
  filePath: string;
  createdAt: number;
  expiresAt: number;
}

const activeCommandTokens = new Map<string, CommandApprovalToken>();
const activeFileTokens = new Map<string, FileApprovalToken>();
const TOKEN_TTL_MS = 60_000; // 60 seconds

/**
 * Mint a single-use approval token bound to an exact shell command and working directory.
 */
export function issueCommandApprovalToken(command: string, cwd: string): string {
  const token = crypto.randomUUID();
  const now = Date.now();
  activeCommandTokens.set(token, {
    token,
    command,
    cwd,
    createdAt: now,
    expiresAt: now + TOKEN_TTL_MS,
  });
  return token;
}

/**
 * Verify and immediately consume a single-use command approval token.
 * Returns true if valid, matching command and cwd, and unexpired.
 */
export function consumeCommandApprovalToken(
  token: string | undefined,
  command: string,
  cwd: string
): boolean {
  if (!token) return false;
  const payload = activeCommandTokens.get(token);
  if (!payload) return false;

  // Single-use: delete immediately on consumption attempt
  activeCommandTokens.delete(token);

  if (Date.now() > payload.expiresAt) {
    return false;
  }

  return payload.command === command && payload.cwd === cwd;
}

/**
 * Mint a single-use approval token bound to an exact sensitive file path.
 */
export function issueFileApprovalToken(filePath: string): string {
  const token = crypto.randomUUID();
  const now = Date.now();
  activeFileTokens.set(token, {
    token,
    filePath,
    createdAt: now,
    expiresAt: now + TOKEN_TTL_MS,
  });
  return token;
}

/**
 * Verify and immediately consume a single-use file approval token.
 */
export function consumeFileApprovalToken(
  token: string | undefined,
  filePath: string
): boolean {
  if (!token) return false;
  const payload = activeFileTokens.get(token);
  if (!payload) return false;

  // Single-use: delete immediately
  activeFileTokens.delete(token);

  if (Date.now() > payload.expiresAt) {
    return false;
  }

  return payload.filePath === filePath;
}

/**
 * For testing and cleanup purposes.
 */
export function _resetApprovalTokens(): void {
  activeCommandTokens.clear();
  activeFileTokens.clear();
}
