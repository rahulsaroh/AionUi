/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import fs from 'fs/promises';

export class HandbookWatcher {
  private knownHashes: Map<string, string> = new Map(); // memberKey -> sha256 hash

  computeHash(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
  }

  async getFileHash(filePath: string): Promise<string | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return this.computeHash(content);
    } catch {
      return null;
    }
  }

  updateHash(memberKey: string, hash: string): void {
    this.knownHashes.set(memberKey, hash);
  }

  getLastHash(memberKey: string): string | undefined {
    return this.knownHashes.get(memberKey);
  }

  remove(memberKey: string): void {
    this.knownHashes.delete(memberKey);
  }

  hasExternalEdit(memberKey: string, currentDiskHash: string): boolean {
    const known = this.knownHashes.get(memberKey);
    if (!known) return false;
    return known !== currentDiskHash;
  }
}

export const handbookWatcher = new HandbookWatcher();
