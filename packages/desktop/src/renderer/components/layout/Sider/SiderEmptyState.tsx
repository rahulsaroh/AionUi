/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

interface SiderEmptyStateProps {
  message?: string;
  hasSearchQuery?: boolean;
}

export const SiderEmptyState: React.FC<SiderEmptyStateProps> = ({ message, hasSearchQuery = false }) => {
  const { t } = useTranslation();

  const defaultMessage = hasSearchQuery
    ? t('team.organization.noSearchResults', {
        defaultValue: 'No departments, teams, or projects match your search.',
      })
    : t('team.organization.noDepartments', { defaultValue: 'No departments found.' });

  return <div className='px-12px py-16px text-center text-11px text-t-tertiary'>{message ?? defaultMessage}</div>;
};

export default React.memo(SiderEmptyState);
