/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';
import { MoveToProjectModal } from '@/renderer/pages/conversation/components/MoveToProjectModal';
import type { WorkspaceGroup } from '@/renderer/pages/conversation/GroupedHistory/types';

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@arco-design/web-react');
  return {
    ...actual,
    Message: {
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    },
  };
});

vi.mock('@/renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({ theme: 'light', fontScale: 1 }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options?.count !== undefined) return `${key}:${options.count}`;
      return key;
    },
  }),
}));

const mockUpdateInvoke = vi.fn().mockResolvedValue(true);
const mockTransferInvoke = vi.fn().mockResolvedValue({ success: true, movedCount: 2 });
const mockShowOpenInvoke = vi.fn().mockResolvedValue(['/selected/new-project']);
const mockGetPathInvoke = vi.fn().mockResolvedValue('/home/user');

vi.mock('@/common', () => ({
  ipcBridge: {
    dialog: {
      showOpen: {
        invoke: (...args: unknown[]) => mockShowOpenInvoke(...args),
      },
    },
    application: {
      getPath: {
        invoke: (...args: unknown[]) => mockGetPathInvoke(...args),
      },
    },
    fs: {
      transferWorkspaceFiles: {
        invoke: (...args: unknown[]) => mockTransferInvoke(...args),
      },
    },
    conversation: {
      update: {
        invoke: (...args: unknown[]) => mockUpdateInvoke(...args),
      },
    },
  },
}));

vi.mock('@/renderer/components/workspace', () => ({
  addRecentWorkspace: vi.fn(),
  getRecentWorkspaces: () => ['/workspaces/project-alpha', '/workspaces/project-beta'],
}));

vi.mock('@/renderer/utils/workspace/workspaceHistory', () => ({
  updateWorkspaceTime: vi.fn(),
}));

describe('MoveToProjectModal', () => {
  const dummyConv: TChatConversation = {
    id: 'conv-123',
    name: 'Test Conversation',
    type: 'chat',
    created_at: 1000,
    modified_at: 2000,
    extra: {
      workspace: '/old/workspace',
      custom_workspace: true,
    },
  } as unknown as TChatConversation;

  const dummyGroups: WorkspaceGroup[] = [
    {
      workspace: '/workspaces/project-alpha',
      display_name: 'project-alpha',
      conversations: [dummyConv],
    },
    {
      workspace: '/workspaces/project-gamma',
      display_name: 'project-gamma',
      conversations: [],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders modal when visible is true', () => {
    render(
      <MoveToProjectModal
        visible={true}
        conversations={[dummyConv]}
        projectGroups={dummyGroups}
        onCancel={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    expect(screen.getByText('conversation.history.moveToProjectTitle')).toBeInTheDocument();
    expect(screen.getByText('Test Conversation')).toBeInTheDocument();
    expect(screen.getByText('/old/workspace')).toBeInTheDocument();
  });

  it('allows switching to new project mode and browsing for a directory', async () => {
    render(
      <MoveToProjectModal
        visible={true}
        conversations={[dummyConv]}
        projectGroups={dummyGroups}
        onCancel={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    // Switch to 'New Project'
    const newProjectRadio = screen.getByRole('radio', { name: 'conversation.history.newProject' });
    fireEvent.click(newProjectRadio);

    // Click Browse button
    const browseButton = screen.getByText('conversation.history.browse');
    fireEvent.click(browseButton);

    await waitFor(() => {
      expect(mockShowOpenInvoke).toHaveBeenCalledWith({
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: '/home/user',
      });
    });
  });

  it('successfully moves conversation to a new project and transfers files', async () => {
    const onSuccess = vi.fn();
    render(
      <MoveToProjectModal
        visible={true}
        conversations={[dummyConv]}
        projectGroups={dummyGroups}
        onCancel={vi.fn()}
        onSuccess={onSuccess}
      />
    );

    // Switch to new project mode
    fireEvent.click(screen.getByRole('radio', { name: 'conversation.history.newProject' }));

    // Input new project path
    const input = screen.getByPlaceholderText('conversation.history.projectFolderPlaceholder');
    fireEvent.change(input, { target: { value: '/target/new-project' } });

    // Click confirm Move
    const moveBtn = screen.getByText('conversation.history.move');
    fireEvent.click(moveBtn);

    await waitFor(() => {
      // Expect files transferred
      expect(mockTransferInvoke).toHaveBeenCalledWith({
        sourcePath: '/old/workspace',
        targetPath: '/target/new-project',
        operation: 'move',
      });

      // Expect conversation updated
      expect(mockUpdateInvoke).toHaveBeenCalledWith({
        id: 'conv-123',
        updates: {
          extra: {
            workspace: '/target/new-project',
            custom_workspace: true,
          },
        },
      });

      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it('supports batch moving multiple conversations', async () => {
    const conv2: TChatConversation = {
      id: 'conv-456',
      name: 'Second Conversation',
      type: 'chat',
      created_at: 1000,
      modified_at: 2000,
      extra: {
        workspace: '/old/workspace-2',
        custom_workspace: true,
      },
    } as unknown as TChatConversation;

    const onSuccess = vi.fn();
    render(
      <MoveToProjectModal
        visible={true}
        conversations={[dummyConv, conv2]}
        projectGroups={dummyGroups}
        onCancel={vi.fn()}
        onSuccess={onSuccess}
      />
    );

    expect(screen.getByText('conversation.history.moveToProjectDescBatch:2')).toBeInTheDocument();

    // Switch to new project mode
    fireEvent.click(screen.getByRole('radio', { name: 'conversation.history.newProject' }));
    const input = screen.getByPlaceholderText('conversation.history.projectFolderPlaceholder');
    fireEvent.change(input, { target: { value: '/batch/target-project' } });

    // Click confirm move
    fireEvent.click(screen.getByText('conversation.history.move'));

    await waitFor(() => {
      expect(mockUpdateInvoke).toHaveBeenCalledTimes(2);
      expect(mockTransferInvoke).toHaveBeenCalledWith({
        sourcePath: '/old/workspace',
        targetPath: '/batch/target-project',
        operation: 'move',
      });
      expect(mockTransferInvoke).toHaveBeenCalledWith({
        sourcePath: '/old/workspace-2',
        targetPath: '/batch/target-project',
        operation: 'move',
      });
      expect(onSuccess).toHaveBeenCalled();
    });
  });
});
