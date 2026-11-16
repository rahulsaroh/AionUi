/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Peoples } from '@icon-park/react';

export const SharedMemberHeaderNode: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className='flex items-center gap-8px px-18px py-8px rounded-full bg-slate-900/80 border border-indigo-500/30 text-indigo-200 text-12px font-medium shadow-lg backdrop-blur-md select-none pointer-events-none'>
      <Peoples size={15} theme='outline' className='text-indigo-400' />
      <span className='tracking-wide'>
        {t('team.organization.sharedPoolTitle', {
          defaultValue: 'Team Members Working Across Multiple Departments / Projects',
        })}
      </span>
    </div>
  );
};

export default React.memo(SharedMemberHeaderNode);
