/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import fs from 'node:fs';
import { getDataPath } from '@process/utils';

export class OrgStorageService {
  private static instance: OrgStorageService | null = null;
  private cache: Map<string, string> = new Map();
  private storageFilePath: string;

  constructor(customPath?: string) {
    this.storageFilePath = customPath || path.join(getDataPath(), 'org_storage.json');
    this.loadFromFile();
  }

  public static getInstance(): OrgStorageService {
    if (!OrgStorageService.instance) {
      OrgStorageService.instance = new OrgStorageService();
    }
    return OrgStorageService.instance;
  }

  private loadFromFile(): void {
    try {
      if (fs.existsSync(this.storageFilePath)) {
        const raw = fs.readFileSync(this.storageFilePath, 'utf8');
        const parsed = JSON.parse(raw) as Record<string, string>;
        if (parsed && typeof parsed === 'object') {
          for (const [k, v] of Object.entries(parsed)) {
            this.cache.set(k, v);
          }
        }
      }
    } catch (err) {
      console.warn('[OrgStorageService] Failed to read storage file:', err);
    }
  }

  private async persistToFile(): Promise<void> {
    try {
      const obj: Record<string, string> = {};
      for (const [k, v] of this.cache.entries()) {
        obj[k] = v;
      }
      const dir = path.dirname(this.storageFilePath);
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }
      const tempPath = `${this.storageFilePath}.tmp.${Date.now()}`;
      await fs.promises.writeFile(tempPath, JSON.stringify(obj, null, 2), 'utf8');
      await fs.promises.rename(tempPath, this.storageFilePath);
    } catch (err) {
      console.warn('[OrgStorageService] Failed to write storage file:', err);
    }
  }

  public async saveData(key: string, value: string): Promise<boolean> {
    this.cache.set(key, value);
    await this.persistToFile();
    return true;
  }

  public async loadData(key: string): Promise<string | null> {
    return this.cache.get(key) ?? null;
  }
}

export const orgStorageService = OrgStorageService.getInstance();
