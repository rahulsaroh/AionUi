/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';

export type CloudSyncProvider =
  | 'google_drive'
  | 'onedrive'
  | 'dropbox'
  | 'icloud'
  | 'box'
  | 'network_share'
  | 'other_cloud';

export type CloudSyncDetection = {
  isCloudSync: boolean;
  provider?: CloudSyncProvider;
  folderName?: string;
  warningMessage?: string;
};

/**
 * Detects whether a path is located inside a Google Drive or other cloud-synced directory
 * (e.g. OneDrive, Dropbox, iCloud Drive, Box, network share).
 */
export function detectCloudSyncPath(targetPath: string): CloudSyncDetection {
  if (!targetPath || typeof targetPath !== 'string') {
    return { isCloudSync: false };
  }

  // Normalize path separators to forward slash and lower case for matching
  const normalized = targetPath.replace(/\\/g, '/').toLowerCase();

  // 1. Google Drive detection
  if (
    normalized.includes('google drive') ||
    normalized.includes('googledrive') ||
    normalized.includes('my drive') ||
    normalized.includes('shared drives') ||
    normalized.includes('.shortcut-targets-by-id') ||
    /^[a-z]:\/(?:my drive|shared drives)/i.test(normalized) ||
    normalized.includes('/google/drivefs')
  ) {
    return {
      isCloudSync: true,
      provider: 'google_drive',
      folderName: 'Google Drive',
      warningMessage:
        'The path is located inside a Google Drive synced folder. File locks, sync conflicts, and partial files may cause git clone and update operations to fail. Please choose a local cache directory outside cloud sync.',
    };
  }

  // 2. OneDrive detection
  let isOneDriveEnv = false;
  if (typeof process !== 'undefined' && process.env) {
    const oneDriveVars = ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial'];
    for (const v of oneDriveVars) {
      const val = process.env[v];
      if (val && normalized.startsWith(val.replace(/\\/g, '/').toLowerCase())) {
        isOneDriveEnv = true;
        break;
      }
    }
  }

  if (normalized.includes('onedrive') || isOneDriveEnv) {
    return {
      isCloudSync: true,
      provider: 'onedrive',
      folderName: 'OneDrive',
      warningMessage:
        'The path is located inside a OneDrive synced folder. File locks and sync conflicts may cause git operations to fail. Please choose a local cache directory outside cloud sync.',
    };
  }

  // 3. Dropbox detection
  if (normalized.includes('dropbox')) {
    return {
      isCloudSync: true,
      provider: 'dropbox',
      folderName: 'Dropbox',
      warningMessage:
        'The path is located inside a Dropbox synced folder. File locks and sync conflicts may cause git operations to fail. Please choose a local cache directory outside cloud sync.',
    };
  }

  // 4. iCloud Drive detection
  if (normalized.includes('icloud') || normalized.includes('mobile documents/com~apple~clouddocs')) {
    return {
      isCloudSync: true,
      provider: 'icloud',
      folderName: 'iCloud Drive',
      warningMessage:
        'The path is located inside an iCloud Drive synced folder. File locks and sync conflicts may cause git operations to fail. Please choose a local cache directory outside cloud sync.',
    };
  }

  // 5. Box Sync detection
  if (normalized.includes('box sync') || normalized.includes('box-sync')) {
    return {
      isCloudSync: true,
      provider: 'box',
      folderName: 'Box Sync',
      warningMessage:
        'The path is located inside a Box synced folder. File locks and sync conflicts may cause git operations to fail. Please choose a local cache directory outside cloud sync.',
    };
  }

  // 6. Network share detection
  if (normalized.startsWith('//') || normalized.startsWith('\\\\')) {
    return {
      isCloudSync: true,
      provider: 'network_share',
      folderName: 'Network Share',
      warningMessage:
        'The path is located on a network share. Network latency and locking issues may cause git operations to fail.',
    };
  }

  return { isCloudSync: false };
}
