/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

export const OrgCanvasLegend: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className='absolute top-16px right-16px z-10 flex flex-col gap-6px p-10px px-12px rounded-14px bg-slate-900/80 backdrop-blur-md border border-slate-700/60 shadow-xl pointer-events-auto select-none text-11px'>
      <span className='font-bold text-9px text-slate-400 uppercase tracking-wider font-mono'>
        {t('team.organization.legendTitle', { defaultValue: 'Legend' })}
      </span>

      <div className='flex items-center gap-12px flex-wrap text-10px font-medium'>
        {/* CEO */}
        <div className='flex items-center gap-5px'>
          <span className='size-8px rounded-full bg-cyan-400 shadow-[0_0_8px_#22D3EE]' />
          <span className='text-slate-300'>CEO</span>
        </div>

        {/* Department */}
        <div className='flex items-center gap-5px'>
          <span className='size-8px rounded-full bg-sky-400 shadow-[0_0_8px_#38BDF8]' />
          <span className='text-slate-300'>
            {t('team.organization.legendDepartment', { defaultValue: 'Department' })}
          </span>
        </div>

        {/* Project */}
        <div className='flex items-center gap-5px'>
          <span className='size-8px rounded-full bg-purple-400 shadow-[0_0_8px_#A855F7]' />
          <span className='text-slate-300'>
            {t('team.organization.legendProject', { defaultValue: 'Project' })}
          </span>
        </div>

        {/* Team */}
        <div className='flex items-center gap-5px'>
          <span className='size-8px rounded-full bg-emerald-400 shadow-[0_0_8px_#34D399]' />
          <span className='text-slate-300'>
            {t('team.organization.legendTeam', { defaultValue: 'Team' })}
          </span>
        </div>

        {/* Dashed Tether Line */}
        <div className='flex items-center gap-6px'>
          <svg width='20' height='6' className='overflow-visible'>
            <line
              x1='0'
              y1='3'
              x2='20'
              y2='3'
              stroke='#818CF8'
              strokeWidth='2'
              strokeDasharray='4 2'
            />
          </svg>
          <span className='text-indigo-300 text-9px'>
            {t('team.organization.legendShared', { defaultValue: 'Works in multiple areas' })}
          </span>
        </div>
      </div>
    </div>
  );
};

export default React.memo(OrgCanvasLegend);
