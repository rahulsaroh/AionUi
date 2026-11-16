/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HandbookDetail, HandbookStatus } from '@/common/types/team/handbookTypes';

const { mockMemberHandbook } = vi.hoisted(() => ({
  mockMemberHandbook: {
    getStatus: vi.fn(),
    create: vi.fn(),
    read: vi.fn(),
    update: vi.fn(),
    revert: vi.fn(),
    listHistory: vi.fn(),
    openFolder: vi.fn(),
    getHandbookDir: vi.fn().mockResolvedValue('/mock/userData/member-handbooks'),
    setHandbookDir: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  memberHandbook: mockMemberHandbook,
  ipcBridge: {},
}));

const mockT = vi.fn((key: string, opts?: { defaultValue?: string; [k: string]: unknown }) => {
  let val = opts?.defaultValue || key;
  if (opts) {
    for (const [k, v] of Object.entries(opts)) {
      if (k !== 'defaultValue') {
        val = val.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
      }
    }
  }
  return val;
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
  }),
}));

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual('@arco-design/web-react');
  return {
    ...actual,
    Message: {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
    },
  };
});

vi.mock('@/renderer/utils/clipboard', () => ({
  copyText: vi.fn().mockResolvedValue(true),
}));

import { HandbookStatusRow } from '@/renderer/components/memberHandbook/HandbookStatusRow';
import { MemberHandbookModal } from '@/renderer/components/memberHandbook/MemberHandbookModal';

describe('Member Handbook UI - "android tester"', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('HandbookStatusRow', () => {
    it('renders created status with Open and Copy path buttons for android tester', async () => {
      const status: HandbookStatus = {
        memberKey: 'team:team-1:slot-1',
        memberName: 'android tester',
        exists: true,
        status: 'created',
        filePath: '/mock/userData/member-handbooks/android tester.md',
        fileHash: 'abc123hash',
        updatedAt: Date.now(),
      };
      mockMemberHandbook.getStatus.mockResolvedValue(status);

      render(
        <HandbookStatusRow
          memberKey='team:team-1:slot-1'
          memberName='android tester'
          role='Android tester'
          model='claude-3-5-sonnet'
        />
      );

      // Using findByText to wait for async getStatus call
      expect(await screen.findByText('created')).toBeInTheDocument();
      expect(screen.getByText('Open')).toBeInTheDocument();
      expect(screen.getByText('Copy path')).toBeInTheDocument();
    });

    it('renders not created status with reason and Create button when handbook missing', async () => {
      const status: HandbookStatus = {
        memberKey: 'team:team-1:slot-1',
        memberName: 'android tester',
        exists: false,
        reason: 'Handbook file not found on disk',
      };
      mockMemberHandbook.getStatus.mockResolvedValue(status);

      render(
        <HandbookStatusRow
          memberKey='team:team-1:slot-1'
          memberName='android tester'
          role='Android tester'
          model='claude-3-5-sonnet'
        />
      );

      expect(await screen.findByText(/Handbook file not found on disk/i)).toBeInTheDocument();
      expect(screen.getByText('Create')).toBeInTheDocument();
    });
  });

  describe('MemberHandbookModal', () => {
    const mockDetail: HandbookDetail = {
      memberKey: 'team:team-1:slot-1',
      memberName: 'android tester',
      role: 'Android tester',
      fileName: 'android tester.md',
      filePath: '/mock/userData/member-handbooks/android tester.md',
      fileHash: 'hash123',
      content:
        '# Employee Handbook: android tester\n\n## Identity & Role\nAndroid test engineer.\n\n## Working Methodology\n1. Run tests.\n\n## Rules\n- Do: Test builds.\n',
      updatedAt: Date.now(),
      budgetTokens: 3000,
    };

    it('loads and displays handbook content and estimated tokens', async () => {
      mockMemberHandbook.read.mockResolvedValue(mockDetail);
      mockMemberHandbook.getStatus.mockResolvedValue({
        memberKey: 'team:team-1:slot-1',
        memberName: 'android tester',
        exists: true,
        status: 'created',
        fileHash: 'hash123',
      });
      mockMemberHandbook.listHistory.mockResolvedValue([]);

      render(
        <MemberHandbookModal
          visible={true}
          memberKey='team:team-1:slot-1'
          memberName='android tester'
          role='Android tester'
          model='claude-3-5-sonnet'
          onClose={vi.fn()}
        />
      );

      expect(await screen.findByDisplayValue(/# Employee Handbook: android tester/)).toBeInTheDocument();
      expect(screen.getByText(/Budget: 3000/)).toBeInTheDocument();
      expect(screen.getByText('Save Handbook')).toBeInTheDocument();
    });

    it('allows editing and saving handbook', async () => {
      mockMemberHandbook.read.mockResolvedValue(mockDetail);
      mockMemberHandbook.getStatus.mockResolvedValue({
        memberKey: 'team:team-1:slot-1',
        memberName: 'android tester',
        exists: true,
        status: 'created',
        fileHash: 'hash123',
      });
      mockMemberHandbook.listHistory.mockResolvedValue([]);
      mockMemberHandbook.update.mockResolvedValue({ success: true, fileHash: 'hash456' });

      render(
        <MemberHandbookModal
          visible={true}
          memberKey='team:team-1:slot-1'
          memberName='android tester'
          role='Android tester'
          model='claude-3-5-sonnet'
          onClose={vi.fn()}
        />
      );

      const textarea = await screen.findByDisplayValue(/# Employee Handbook: android tester/);
      fireEvent.change(textarea, { target: { value: '# Updated Handbook Content' } });

      const saveBtn = screen.getByRole('button', { name: /save handbook/i });
      fireEvent.click(saveBtn);

      expect(mockMemberHandbook.update).toHaveBeenCalledWith({
        memberKey: 'team:team-1:slot-1',
        content: '# Updated Handbook Content',
      });
    });

    it('switches between Edit, Preview, and Version History tabs', async () => {
      mockMemberHandbook.read.mockResolvedValue(mockDetail);
      mockMemberHandbook.getStatus.mockResolvedValue({
        memberKey: 'team:team-1:slot-1',
        memberName: 'android tester',
        exists: true,
        status: 'created',
        fileHash: 'hash123',
      });
      mockMemberHandbook.listHistory.mockResolvedValue([
        {
          id: 'v2',
          version: 2,
          memberKey: 'team:team-1:slot-1',
          fileName: 'android tester.md',
          fileHash: 'v2hash',
          timestamp: Date.now(),
          contentPreview: 'Latest changes',
          author: 'user',
        },
        {
          id: 'v1',
          version: 1,
          memberKey: 'team:team-1:slot-1',
          fileName: 'android tester.md',
          fileHash: 'v1hash',
          timestamp: Date.now() - 60000,
          contentPreview: 'Initial version',
          author: 'user',
        },
      ]);

      render(
        <MemberHandbookModal
          visible={true}
          memberKey='team:team-1:slot-1'
          memberName='android tester'
          role='Android tester'
          model='claude-3-5-sonnet'
          onClose={vi.fn()}
        />
      );

      expect(await screen.findByDisplayValue(/# Employee Handbook: android tester/)).toBeInTheDocument();

      // Switch to preview tab
      const previewRadio = screen.getByDisplayValue('preview').closest('label')!;
      fireEvent.click(previewRadio);

      expect(await screen.findByText(/\[EMPLOYEE HANDBOOK: android tester\]/)).toBeInTheDocument();

      // Switch to history tab
      const historyRadio = screen.getByDisplayValue('history').closest('label')!;
      fireEvent.click(historyRadio);

      expect(await screen.findByText('Current')).toBeInTheDocument();
      expect(screen.getByText('Initial version')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /revert/i })).toBeInTheDocument();
    });
  });
});
