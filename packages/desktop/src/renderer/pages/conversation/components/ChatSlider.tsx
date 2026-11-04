/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { Radio } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExplorerContainer } from '../explorer/ExplorerContainer';
import AntigravityWorkspaceCard from './AntigravityWorkspaceCard';

/**
 * ChatLayout's right-sider content.
 * Displays the Antigravity workspace execution & task tracking card,
 * and allows switching to the file Explorer when a project is bound.
 */
const ChatSlider: React.FC<{
  conversation?: TChatConversation;
}> = ({ conversation }) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'execution' | 'files'>('execution');

  if (conversation?.project_id) {
    return (
      <div className='h-full flex flex-col min-h-0 bg-[var(--color-bg-1)]'>
        <div className='p-8px border-b border-[var(--color-border-2)] flex justify-center'>
          <Radio.Group
            type='button'
            size='small'
            value={activeTab}
            onChange={(val) => setActiveTab(val as 'execution' | 'files')}
          >
            <Radio value='execution'>
              {t('conversation.antigravityWorkspace.tabExecution', { defaultValue: 'Execution' })}
            </Radio>
            <Radio value='files'>{t('conversation.antigravityWorkspace.tabFiles', { defaultValue: 'Files' })}</Radio>
          </Radio.Group>
        </div>
        <div className='flex-1 min-h-0'>
          {activeTab === 'execution' ? (
            <AntigravityWorkspaceCard conversation={conversation} />
          ) : (
            <ExplorerContainer projectId={conversation.project_id} />
          )}
        </div>
      </div>
    );
  }

  return <AntigravityWorkspaceCard conversation={conversation} />;
};

export default ChatSlider;
