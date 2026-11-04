/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Button, Dropdown, Menu, Message, Tooltip } from '@arco-design/web-react';
import { ApplicationOne, Browser, Download, ListCheckbox, OffScreenTwo } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import {
  dispatchWorkspaceToggleEvent,
  WORKSPACE_STATE_EVENT,
  type WorkspaceStateDetail,
} from '@/renderer/utils/workspace/workspaceEvents';
import { buildConversationMarkdown } from '../GroupedHistory/utils/exportHelpers';
import { ArtifactGalleryModal } from './ArtifactGalleryModal';

type ChatHeaderActionsProps = {
  conversation?: TChatConversation;
  isBrowserOpen: boolean;
  onToggleBrowser: () => void;
};

export const ChatHeaderActions: React.FC<ChatHeaderActionsProps> = ({
  conversation,
  isBrowserOpen,
  onToggleBrowser,
}) => {
  const { t } = useTranslation();
  const [isArtifactsOpen, setIsArtifactsOpen] = useState(false);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);

  useEffect(() => {
    const handleState = (e: Event) => {
      const customEvent = e as CustomEvent<WorkspaceStateDetail>;
      if (customEvent.detail) {
        setIsWorkspaceOpen(!customEvent.detail.collapsed);
      }
    };
    window.addEventListener(WORKSPACE_STATE_EVENT, handleState);
    return () => {
      window.removeEventListener(WORKSPACE_STATE_EVENT, handleState);
    };
  }, []);

  const handleExport = async (format: 'md' | 'json') => {
    if (!conversation?.id) return;
    try {
      const messagesRes = await (ipcBridge.conversation as any).getMessages?.invoke?.({
        conversation_id: conversation.id,
        page: 1,
        page_size: 1000,
      });
      const messages = Array.isArray(messagesRes) ? messagesRes : (messagesRes as { list?: unknown[] })?.list || [];

      let content = '';
      const ext = format === 'json' ? 'json' : 'md';
      const mime = format === 'json' ? 'application/json' : 'text/markdown';

      if (format === 'json') {
        content = JSON.stringify({ conversation, messages }, null, 2);
      } else {
        content = buildConversationMarkdown(conversation, messages as never[]);
      }

      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${conversation.name || 'conversation'}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      Message.success(`Exported as ${format.toUpperCase()}`);
    } catch {
      Message.error('Failed to export conversation');
    }
  };

  const handlePopOut = () => {
    if (!conversation?.id) return;
    const url = `${window.location.origin}${window.location.pathname}#/conversation/${conversation.id}?detached=true`;
    window.open(url, `chat-${conversation.id}`, 'width=1100,height=800,menubar=no,status=no,toolbar=no');
  };

  const exportMenu = (
    <Menu onClickMenuItem={(key) => handleExport(key as 'md' | 'json')}>
      <Menu.Item key='md'>Export as Markdown (.md)</Menu.Item>
      <Menu.Item key='json'>Export as JSON (.json)</Menu.Item>
    </Menu>
  );

  return (
    <div className='flex items-center gap-6px'>
      <Tooltip content='Artifact Gallery'>
        <Button
          icon={<ApplicationOne theme='outline' size='16' />}
          onClick={() => setIsArtifactsOpen(true)}
          shape='circle'
          size='small'
        />
      </Tooltip>

      <Dropdown droplist={exportMenu} trigger='click' position='bottom'>
        <Tooltip content='Export Conversation'>
          <Button icon={<Download theme='outline' size='16' />} shape='circle' size='small' />
        </Tooltip>
      </Dropdown>

      <Tooltip content='Pop out into new window'>
        <Button icon={<OffScreenTwo theme='outline' size='16' />} onClick={handlePopOut} shape='circle' size='small' />
      </Tooltip>

      <div className='shrink-0'>
        <Tooltip content={t('conversation.browser.title')}>
          <Button
            icon={<Browser theme='outline' size='16' />}
            onClick={onToggleBrowser}
            shape='circle'
            size='small'
            type={isBrowserOpen ? 'primary' : 'secondary'}
          />
        </Tooltip>
      </div>

      <div className='shrink-0'>
        <Tooltip content={t('conversation.antigravityWorkspace.toggleCard', { defaultValue: 'Execution & Tasks' })}>
          <Button
            icon={<ListCheckbox theme='outline' size='16' />}
            onClick={() => dispatchWorkspaceToggleEvent()}
            shape='circle'
            size='small'
            type={isWorkspaceOpen ? 'primary' : 'secondary'}
          />
        </Tooltip>
      </div>

      {conversation?.id && (
        <ArtifactGalleryModal
          visible={isArtifactsOpen}
          onClose={() => setIsArtifactsOpen(false)}
          conversationId={conversation.id}
        />
      )}
    </div>
  );
};
