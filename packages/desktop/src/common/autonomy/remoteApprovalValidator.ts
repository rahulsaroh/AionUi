/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { isActionOutsideWorkspace, isNeverAutoApprove } from './policyEvaluator';
import type { ActionContext, AutonomyConfig } from './types';

export interface RemoteValidationParams {
  isRemote: boolean;
  context: ActionContext;
  config: AutonomyConfig;
}

/**
 * Checks whether an incoming request comes from a remote network client
 * (i.e. not local loopback 127.0.0.1 or ::1).
 */
export function isRemoteRequest(req: {
  socket?: { remoteAddress?: string };
  headers?: Record<string, string | string[] | undefined>;
}): boolean {
  if (req.headers && (req.headers['x-remote-session'] === 'true' || req.headers['x-remote-client'] === 'true')) {
    return true;
  }
  const addr = req.socket?.remoteAddress;
  if (!addr) return false;
  return addr !== '127.0.0.1' && addr !== '::1' && addr !== '::ffff:127.0.0.1';
}

/**
 * Validates that a remote web-host session cannot approve actions that exceed
 * what the autonomy profile permits, and never actions on the never-auto-approve list.
 */
export function validateRemoteApproval(params: RemoteValidationParams): {
  allowed: boolean;
  statusCode?: number;
  reason?: string;
} {
  if (!params.isRemote) {
    return { allowed: true };
  }

  // 1. Actions on the NEVER auto-approve list (deleting outside project folder,
  // credentials access, publishing, spending money) can NEVER be approved remotely.
  const neverCheck = isNeverAutoApprove(params.context);
  if (neverCheck.blocked) {
    return {
      allowed: false,
      statusCode: 403,
      reason: `Remote approval rejected: ${neverCheck.reason}`,
    };
  }

  // 2. Under 'ask' or 'trusted_workspace', remote session cannot approve actions outside the workspace
  if (params.config.profile !== 'autopilot' && isActionOutsideWorkspace(params.context)) {
    return {
      allowed: false,
      statusCode: 403,
      reason: 'Remote approval rejected: cannot approve actions outside workspace under non-autopilot profile',
    };
  }

  return { allowed: true };
}
