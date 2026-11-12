/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Card, Button, Typography, Space } from '@arco-design/web-react';
import { FolderClose, Check, Close } from '@icon-park/react';
import type { ProposalCardData } from '../utils/rootCeoAgent';

interface OrgProposalCardProps {
  cardData: ProposalCardData;
  onApprove: (card: ProposalCardData) => void;
  onReject: () => void;
}

export const OrgProposalCard: React.FC<OrgProposalCardProps> = ({ cardData, onApprove, onReject }) => {
  return (
    <Card
      size='small'
      className='my-8px border-primary/40 bg-bg-2 shadow-sm rounded-8px overflow-hidden max-w-640px'
      title={
        <div className='flex items-center gap-6px text-13px font-semibold text-primary'>
          <FolderClose size={16} />
          <span>Proposed Projects for {cardData.departmentName}</span>
        </div>
      }
      extra={
        <Space size='small'>
          <Button size='mini' type='secondary' icon={<Close size={12} />} onClick={onReject}>
            Reject
          </Button>
          <Button size='mini' type='primary' icon={<Check size={12} />} onClick={() => onApprove(cardData)}>
            Approve All ({cardData.projects.length})
          </Button>
        </Space>
      }
    >
      <div className='flex flex-col gap-8px'>
        <Typography.Text type='secondary' className='text-12px'>
          Root CEO scanned the workspace and discovered {cardData.projects.length} distinct application/product
          projects. Review and approve their creation:
        </Typography.Text>
        <div className='flex flex-col gap-6px max-h-240px overflow-y-auto pr-4px'>
          {cardData.projects.map((proj, idx) => (
            <div key={idx} className='p-8px rounded-6px bg-fill-2 border border-border-2 flex flex-col gap-2px'>
              <div className='font-medium text-12px text-t-primary'>{proj.name}</div>
              <div className='text-11px font-mono text-t-tertiary truncate'>{proj.folder}</div>
              {proj.description && <div className='text-11px text-t-secondary'>{proj.description}</div>}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
};
