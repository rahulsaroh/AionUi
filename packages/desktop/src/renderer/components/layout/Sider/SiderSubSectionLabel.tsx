/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

interface SiderSubSectionLabelProps {
  label: string;
  count: number;
}

export const SiderSubSectionLabel: React.FC<SiderSubSectionLabelProps> = ({ label, count }) => {
  const { t } = useTranslation();

  return (
    <div className='px-8px py-2px text-10px font-semibold uppercase tracking-wider text-t-tertiary'>
      {t(label, { defaultValue: label })} ({count})
    </div>
  );
};

export default React.memo(SiderSubSectionLabel);
