/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { mergeManualNotes } from '@/process/services/org/orgDirectory';

const generated = `# Organization Directory

## Departments

- Engineering owns C:/org/engineering

## Manual Notes
<!-- Add durable department notes here (data locations, conventions, owners). AionUi preserves this section when the directory is regenerated. -->
`;

describe('orgDirectory document persistence', () => {
  it('preserves human-written manual notes when regenerating', () => {
    const previous = `# Organization Directory

## Manual Notes
- Invoices live in C:/org/engineering/invoice-api/data
- Ask Ava before touching billing schema
`;

    const merged = mergeManualNotes(generated, previous);

    expect(merged).toContain('- Invoices live in C:/org/engineering/invoice-api/data');
    expect(merged).toContain('Ask Ava before touching billing schema');
    expect(merged).toContain('Engineering owns C:/org/engineering');
    expect(merged).not.toContain('AionUi preserves this section');
  });

  it('keeps the generated placeholder when no human notes exist', () => {
    expect(mergeManualNotes(generated, null)).toBe(generated);
    expect(mergeManualNotes(generated, generated)).toBe(generated);
  });

  it('leaves content unchanged when the previous document had no notes section', () => {
    expect(mergeManualNotes(generated, '# Organization Directory\n\nOld content')).toBe(generated);
  });
});
