/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RememberedRulesContent } from '@/renderer/pages/settings/RememberedRulesSettings';
import {
  addRememberedRule,
  clearRememberedRules,
} from '@/common/autonomy/rulesStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue || _key,
  }),
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: {
      success: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    },
    // Simplify Popconfirm to immediately call onOk
    Popconfirm: ({ onOk, children }: any) => (
      <span onClick={onOk} role='button' tabIndex={0}>
        {children}
      </span>
    ),
  };
});

describe('RememberedRulesContent Component', () => {
  beforeEach(() => {
    clearRememberedRules();
  });

  it('renders list of rules and allows revoking', async () => {
    const rule1 = addRememberedRule({
      projectId: 'proj-web',
      tool: 'bash',
      pattern: 'npm test',
    });
    const rule2 = addRememberedRule({
      projectId: 'proj-backend',
      tool: 'cargo',
      pattern: 'cargo test',
    });

    render(
      <MemoryRouter>
        <RememberedRulesContent />
      </MemoryRouter>
    );

    // Verify rules are displayed
    expect(screen.getByText('proj-web')).toBeInTheDocument();
    expect(screen.getByText('proj-backend')).toBeInTheDocument();
    expect(screen.getByText('npm test')).toBeInTheDocument();
    expect(screen.getByText('cargo test')).toBeInTheDocument();

    // Revoke rule 1
    const revokeBtn = screen.getByTestId(`btn-revoke-rule-${rule1.id}`);
    fireEvent.click(revokeBtn);

    await waitFor(() => {
      expect(screen.queryByText('proj-web')).not.toBeInTheDocument();
      expect(screen.getByText('proj-backend')).toBeInTheDocument();
    });
  });

  it('filters rules by search input', async () => {
    addRememberedRule({
      projectId: 'frontend-app',
      tool: 'vite',
      pattern: 'vite build',
    });
    addRememberedRule({
      projectId: 'backend-service',
      tool: 'docker',
      pattern: 'docker build',
    });

    render(
      <MemoryRouter>
        <RememberedRulesContent />
      </MemoryRouter>
    );

    expect(screen.getByText('frontend-app')).toBeInTheDocument();
    expect(screen.getByText('backend-service')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText(/Search project, tool, pattern/i);
    fireEvent.change(searchInput, { target: { value: 'vite' } });

    await waitFor(() => {
      expect(screen.getByText('frontend-app')).toBeInTheDocument();
      expect(screen.queryByText('backend-service')).not.toBeInTheDocument();
    });
  });
});
