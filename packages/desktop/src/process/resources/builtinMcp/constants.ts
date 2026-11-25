/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Keep this constant local to avoid pulling in common/config/storage side effects
// when the built-in MCP server boots in a standalone stdio process.
export const BUILTIN_IMAGE_GEN_ID = 'builtin-image-gen';
export const BUILTIN_IMAGE_GEN_NAME = 'aionui-image-generation';
export const BUILTIN_IMAGE_GEN_LEGACY_NAMES = ['AionUi Image Generation', BUILTIN_IMAGE_GEN_ID] as const;

export function isBuiltinImageGenName(name?: string | null): boolean {
  if (!name) return false;
  return (
    name === BUILTIN_IMAGE_GEN_NAME ||
    BUILTIN_IMAGE_GEN_LEGACY_NAMES.includes(name as (typeof BUILTIN_IMAGE_GEN_LEGACY_NAMES)[number])
  );
}

export function isBuiltinImageGenTransport(transport?: {
  type?: string;
  command?: string;
  args?: string[] | null;
}): boolean {
  if (!transport || transport.type !== 'stdio' || transport.command !== 'node') {
    return false;
  }

  return (transport.args || []).some((arg) => typeof arg === 'string' && arg.includes('builtin-mcp-image-gen.js'));
}

export const BUILTIN_ORG_MCP_ID = 'builtin-org';
export const BUILTIN_ORG_MCP_NAME = 'aionui-org';
export const BUILTIN_ORG_SCRIPT = 'builtin-mcp-org';

export const BUILTIN_DESKTOP_CONTROL_ID = 'builtin-desktop-control';
export const BUILTIN_DESKTOP_CONTROL_NAME = 'aionui-desktop-control';
export const BUILTIN_DESKTOP_CONTROL_SCRIPT = 'builtin-mcp-desktop-control';

export function isBuiltinOrgName(name?: string | null): boolean {
  if (!name) return false;
  return name === BUILTIN_ORG_MCP_NAME || name === BUILTIN_ORG_MCP_ID;
}
