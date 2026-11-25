/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { CURATED_MCP_REGISTRY } from '../../packages/desktop/src/renderer/pages/settings/ToolsSettings/McpRegistryModal';

describe('CURATED_MCP_REGISTRY', () => {
  it('contains unique entries with valid transport configs', () => {
    const ids = new Set<string>();
    expect(CURATED_MCP_REGISTRY.length).toBeGreaterThan(0);

    for (const entry of CURATED_MCP_REGISTRY) {
      expect(ids.has(entry.id)).toBe(false);
      ids.add(entry.id);
      expect(entry.name.trim().length).toBeGreaterThan(0);
      expect(entry.description.trim().length).toBeGreaterThan(0);
      expect(entry.transport.type).toBe('stdio');
    }
  });
});
