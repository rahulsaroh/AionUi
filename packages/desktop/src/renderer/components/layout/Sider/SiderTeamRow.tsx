/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Tooltip } from '@arco-design/web-react';
import { User, Edit } from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import type { OrgTeamNode, OrgNodeStatus } from '@/types/organization';
import { ORG_THEME_PALETTE } from '@/renderer/pages/organization/utils/orgTheme';

interface SiderTeamRowProps {
  team: OrgTeamNode;
  status: OrgNodeStatus;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: (e?: React.MouseEvent | Event) => void;
  siderTooltipProps: SiderTooltipProps;
}

export const SiderTeamRow: React.FC<SiderTeamRowProps> = ({
  team,
  status,
  isSelected,
  onSelect,
  onEdit,
  siderTooltipProps,
}) => {
  const { t } = useTranslation();
  const theme = ORG_THEME_PALETTE[status];

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className={classNames(
        'group flex items-center justify-between px-6px py-3px rounded cursor-pointer transition-colors text-11px select-none',
        isSelected
          ? 'bg-[rgba(var(--primary-6),0.10)] text-t-primary border border-[rgba(var(--primary-6),0.20)]'
          : 'hover:bg-fill-2 text-t-secondary hover:text-t-primary'
      )}
    >
      <div className='flex items-center gap-5px truncate min-w-0'>
        <User size={11} theme='outline' className='text-primary shrink-0' />
        <span className='truncate text-11px' title={team.name}>
          {team.name}
        </span>
      </div>
      <div className='flex items-center gap-3px shrink-0'>
        <Tooltip
          {...siderTooltipProps}
          content={t('team.organization.editTeam', { defaultValue: 'Edit Team' })}
          position='top'
        >
          <Button
            type='text'
            size='mini'
            className='!size-16px !p-0 rounded flex items-center justify-center text-t-tertiary hover:text-t-primary hover:bg-fill-3 opacity-0 group-hover:opacity-100 transition-opacity border-none'
            onClick={(e) => onEdit(e)}
            aria-label={t('team.organization.editTeam', { defaultValue: 'Edit Team' })}
          >
            <Edit size={10} theme='outline' />
          </Button>
        </Tooltip>
        <span className='size-4px rounded-full shrink-0 opacity-60' style={{ backgroundColor: theme.borderColor }} />
      </div>
    </div>
  );
};

export default React.memo(SiderTeamRow);
