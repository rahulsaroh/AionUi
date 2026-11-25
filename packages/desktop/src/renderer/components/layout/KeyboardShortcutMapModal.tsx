/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Modal, Table, Tag, Typography } from '@arco-design/web-react';
import { isMacOS } from '@renderer/utils/platform';

type ShortcutEntry = {
  key: string;
  command: string;
  description: string;
  category: string;
};

export const KeyboardShortcutMapModal: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const isMac = isMacOS();
  const mod = isMac ? '⌘' : 'Ctrl';

  useEffect(() => {
    const handleToggle = () => {
      setVisible((prev) => !prev);
    };

    window.addEventListener('aionui:toggle-shortcut-map', handleToggle);
    return () => {
      window.removeEventListener('aionui:toggle-shortcut-map', handleToggle);
    };
  }, []);

  const shortcuts: ShortcutEntry[] = [
    {
      key: '1',
      command: `${mod} + K`,
      description: 'Quick switcher: search conversations, teams, projects, and settings',
      category: 'Navigation',
    },
    {
      key: '2',
      command: `${mod} + ,`,
      description: 'Toggle Settings (or return to previous view)',
      category: 'Navigation',
    },
    {
      key: '3',
      command: `${mod} + Shift + W`,
      description: 'Toggle between Workplace and Organization',
      category: 'Navigation',
    },
    {
      key: '4',
      command: `${mod} + 1 / 3 / 4 / 5`,
      description: 'Jump to Team / Workplace / Organization / Approvals',
      category: 'Navigation',
    },
    {
      key: '5',
      command: `${mod} + N / ${mod} + T`,
      description: 'Start a new conversation',
      category: 'Chat',
    },
    {
      key: '6',
      command: `${mod} + B`,
      description: 'Toggle sidebar visibility',
      category: 'Layout',
    },
    {
      key: '7',
      command: `${mod} + L`,
      description: 'Toggle workspace explorer',
      category: 'Layout',
    },
    {
      key: '8',
      command: `${mod} + Shift + O`,
      description: 'Switch to Organization Org-Chart Canvas',
      category: 'Navigation',
    },
    {
      key: '9',
      command: isMac ? '⌘ + Shift + T' : 'Ctrl + Shift + T',
      description: 'Toggle Dark / Light appearance theme',
      category: 'Preferences',
    },
    {
      key: '10',
      command: `${mod} + ? / ${mod} + /`,
      description: 'Open keyboard shortcuts map',
      category: 'Help',
    },
    {
      key: '11',
      command: 'Esc',
      description: 'Close active popover or dialog',
      category: 'General',
    },
  ];

  const columns = [
    {
      title: 'Shortcut',
      dataIndex: 'command',
      key: 'command',
      width: 170,
      render: (val: string) => (
        <Tag color='arcoblue' className='font-mono font-medium'>
          {val}
        </Tag>
      ),
    },
    {
      title: 'Action',
      dataIndex: 'description',
      key: 'description',
      render: (val: string) => <Typography.Text>{val}</Typography.Text>,
    },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      width: 120,
      render: (val: string) => (
        <Tag bordered color='gray'>
          {val}
        </Tag>
      ),
    },
  ];

  return (
    <Modal
      title={
        <Typography.Title heading={6} className='!m-0'>
          Keyboard Shortcuts
        </Typography.Title>
      }
      visible={visible}
      onOk={() => setVisible(false)}
      onCancel={() => setVisible(false)}
      footer={null}
      autoFocus={false}
      focusLock={true}
      style={{ width: 560 }}
    >
      <Table pagination={false} columns={columns} data={shortcuts} rowKey='key' size='small' border={false} />
    </Modal>
  );
};
