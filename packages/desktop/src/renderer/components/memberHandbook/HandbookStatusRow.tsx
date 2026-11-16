/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Message, Tag, Tooltip } from '@arco-design/web-react';
import { BookOpen, Copy, Edit, FolderOpen } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { memberHandbook } from '@/common/adapter/ipcBridge';
import type { HandbookStatus } from '@/common/types/team/handbookTypes';
import { MemberHandbookModal } from './MemberHandbookModal';

export type HandbookStatusRowProps = {
  memberKey: string;
  memberName: string;
  role?: string;
  model?: string;
  compact?: boolean;
};

export const HandbookStatusRow: React.FC<HandbookStatusRowProps> = ({
  memberKey,
  memberName,
  role,
  model,
  compact = false,
}) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<HandbookStatus | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const fetchStatus = useCallback(async () => {
    if (!memberKey) return;
    try {
      const st = await memberHandbook.getStatus({ memberKey, memberName });
      setStatus(st);
      if (st.status === 'error' && st.reason) {
        Message.error(t('team.handbook.statusError', { defaultValue: `Handbook: ${st.reason}`, reason: st.reason }));
      }
    } catch (err) {
      Message.error(String(err));
    }
  }, [memberKey, memberName, t]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const handleCopyPath = useCallback(async () => {
    if (!status?.filePath) return;
    try {
      await navigator.clipboard.writeText(status.filePath);
      Message.success(t('team.handbook.pathCopied', { defaultValue: 'Handbook path copied to clipboard' }));
    } catch {
      Message.error('Failed to copy path');
    }
  }, [status, t]);

  const handleOpenFolder = useCallback(async () => {
    try {
      const ok = await memberHandbook.openFolder();
      if (!ok) {
        Message.warning('Cannot open folder in this environment');
      }
    } catch (err) {
      Message.error(String(err));
    }
  }, []);

  const isCreated = status?.status === 'created' && status.exists;

  return (
    <>
      <div className='flex items-center justify-between gap-6px flex-wrap text-11px'>
        <div className='flex items-center gap-6px min-w-0'>
          <span className='text-t-tertiary font-medium shrink-0'>
            {t('team.handbook.title', { defaultValue: 'Handbook' })}:
          </span>
          {isCreated ? (
            <Tooltip content={status.filePath} position='top'>
              <Tag size='small' color='green' className='cursor-pointer font-mono text-10px'>
                {t('team.handbook.statusCreated', { defaultValue: 'created' })}
              </Tag>
            </Tooltip>
          ) : (
            <Tag size='small' color='orange' className='font-mono text-10px'>
              {t('team.handbook.statusNotCreated', {
                defaultValue: `not created: ${status?.reason || 'pending'}`,
                reason: status?.reason || 'pending',
              })}
            </Tag>
          )}
        </div>

        <div className='flex items-center gap-4px'>
          {isCreated && (
            <Button
              size='mini'
              type='secondary'
              icon={<Copy size={12} />}
              onClick={handleCopyPath}
              className='!px-6px !h-20px text-10px'
            >
              {t('team.handbook.copyPath', { defaultValue: 'Copy path' })}
            </Button>
          )}
          <Button
            size='mini'
            type='outline'
            icon={<BookOpen size={12} />}
            onClick={() => setIsModalOpen(true)}
            className='!px-6px !h-20px text-10px'
          >
            {compact ? (
              <Edit size={11} />
            ) : isCreated ? (
              t('team.handbook.open', { defaultValue: 'Open' })
            ) : (
              t('team.handbook.createBtn', { defaultValue: 'Create' })
            )}
          </Button>
        </div>
      </div>

      {isModalOpen && (
        <MemberHandbookModal
          visible={isModalOpen}
          memberKey={memberKey}
          memberName={memberName}
          role={role}
          model={model}
          onClose={() => {
            setIsModalOpen(false);
            void fetchStatus();
          }}
          onSaved={() => void fetchStatus()}
        />
      )}
    </>
  );
};
