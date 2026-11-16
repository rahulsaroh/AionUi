/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Input, Tooltip } from '@arco-design/web-react';
import { Edit, Check, Close } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useOrgStore } from '../store/useOrgStore';

export const OrgCanvasTitleBlock: React.FC = () => {
  const { t } = useTranslation();
  const { hierarchy, updateRootCeo } = useOrgStore();

  const currentOrgName = hierarchy.rootCeo.name || t('team.organization.orgTitleDefault', { defaultValue: 'AI Organization Structure' });
  const [isEditing, setIsEditing] = useState(false);
  const [titleValue, setTitleValue] = useState(currentOrgName);

  useEffect(() => {
    setTitleValue(hierarchy.rootCeo.name || t('team.organization.orgTitleDefault', { defaultValue: 'AI Organization Structure' }));
  }, [hierarchy.rootCeo.name, t]);

  const handleSave = () => {
    const trimmed = titleValue.trim();
    if (trimmed && trimmed !== hierarchy.rootCeo.name) {
      updateRootCeo({ name: trimmed });
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setTitleValue(currentOrgName);
    setIsEditing(false);
  };

  return (
    <div className='absolute top-16px left-16px z-10 flex flex-col gap-2px max-w-440px p-12px rounded-14px bg-slate-900/80 backdrop-blur-md border border-slate-700/60 shadow-xl pointer-events-auto select-none'>
      <div className='flex items-center gap-8px'>
        {isEditing ? (
          <div className='flex items-center gap-4px flex-1'>
            <Input
              size='mini'
              value={titleValue}
              onChange={setTitleValue}
              onPressEnter={handleSave}
              autoFocus
              className='!bg-slate-800 !text-slate-100 !text-13px !font-bold !h-26px'
            />
            <button
              type='button'
              onClick={handleSave}
              className='p-4px rounded hover:bg-slate-700 text-emerald-400 border-none cursor-pointer'
            >
              <Check size={14} />
            </button>
            <button
              type='button'
              onClick={handleCancel}
              className='p-4px rounded hover:bg-slate-700 text-rose-400 border-none cursor-pointer'
            >
              <Close size={14} />
            </button>
          </div>
        ) : (
          <div className='flex items-center gap-6px group cursor-pointer' onClick={() => setIsEditing(true)}>
            <span className='font-bold text-14px tracking-wide text-slate-100 group-hover:text-cyan-300 transition-colors'>
              {currentOrgName}
            </span>
            <Tooltip content='Edit Organization Title'>
              <Edit size={12} className='text-slate-500 group-hover:text-cyan-400 opacity-60 group-hover:opacity-100 transition-opacity' />
            </Tooltip>
          </div>
        )}
      </div>

      <span className='text-10px text-slate-400 leading-tight font-medium'>
        {t('team.organization.orgSubtitleDefault', {
          defaultValue: 'A Hierarchical, Multi-Project, Cross-Team Collaboration Model',
        })}
      </span>
    </div>
  );
};

export default React.memo(OrgCanvasTitleBlock);
