/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { app, session, safeStorage } from 'electron';
import {
  BROWSER_PARTITION_PREFIX,
  DEFAULT_BROWSER_PROFILE,
  DEFAULT_BROWSER_PROFILE_ID,
  DEFAULT_EXTERNAL_CHROME_PORT,
} from '@/common/browser/constants';
import type {
  BrowserProfile,
  ClearProfileDataResult,
  CreateProfileInput,
  UpdateProfileInput,
} from '@/common/browser/types';
import { getBrowserAssignmentService } from '@process/services/browser/BrowserAssignmentService';

export { getBrowserAssignmentService };

export class BrowserProfileService {
  private profiles: Map<string, BrowserProfile> = new Map();
  private activeProfileId: string = DEFAULT_BROWSER_PROFILE_ID;
  private readonly configFilePath: string;
  private readonly userDataRoot: string;

  constructor(options?: { userDataPath?: string; configFilePath?: string }) {
    this.userDataRoot = options?.userDataPath || this.resolveUserDataRoot();
    this.configFilePath = options?.configFilePath || path.join(this.userDataRoot, 'browser_profiles.json');
    this.loadProfiles();
  }

  public encryptSensitive(plaintext: string): string {
    if (!plaintext) return '';
    try {
      if (
        typeof safeStorage !== 'undefined' &&
        typeof safeStorage.isEncryptionAvailable === 'function' &&
        safeStorage.isEncryptionAvailable()
      ) {
        const encrypted = safeStorage.encryptString(plaintext);
        return `safe:${encrypted.toString('base64')}`;
      }
    } catch {
      // safeStorage error or unavailable
    }
    return `plain:${plaintext}`;
  }

  public decryptSensitive(ciphertext: string): string {
    if (!ciphertext) return '';
    if (ciphertext.startsWith('safe:')) {
      try {
        if (
          typeof safeStorage !== 'undefined' &&
          typeof safeStorage.isEncryptionAvailable === 'function' &&
          safeStorage.isEncryptionAvailable()
        ) {
          const raw = Buffer.from(ciphertext.slice(5), 'base64');
          return safeStorage.decryptString(raw);
        }
      } catch {
        return '';
      }
    }
    if (ciphertext.startsWith('plain:')) {
      return ciphertext.slice(6);
    }
    return ciphertext;
  }

  /**
   * Asserts that an agent cannot access cookies, credentials, or session tokens.
   */
  public assertAgentCannotAccessCookies(action: string, params: unknown): void {
    if (!params || typeof params !== 'object') return;
    const str = JSON.stringify(params).toLowerCase();
    if (
      str.includes('document.cookie') ||
      str.includes('sessionstorage') ||
      str.includes('localstorage') ||
      str.includes('authtoken') ||
      str.includes('authorization') ||
      str.includes('bearertoken') ||
      str.includes('set-cookie')
    ) {
      throw new Error(`Security policy violation: Agent access to cookies, tokens, or credentials is prohibited.`);
    }
  }

  /**
   * Scrubs cookies and tokens from data returned to agents.
   */
  public scrubAgentOutput<T>(data: T): T {
    if (!data) return data;
    if (typeof data === 'string') {
      return data
        .replace(/cookie:[^\n\r]+/gi, 'cookie: [REDACTED]')
        .replace(/authorization:\s*bearer\s+[^\s\n\r]+/gi, 'authorization: Bearer [REDACTED]')
        .replace(/set-cookie:[^\n\r]+/gi, 'set-cookie: [REDACTED]') as unknown as T;
    }
    if (typeof data === 'object') {
      try {
        let serialized = JSON.stringify(data);
        serialized = serialized
          .replace(/cookie:[^\n\r\\"]+/gi, 'cookie: [REDACTED]')
          .replace(/authorization:\s*bearer\s+[^\s\n\r\\"]+/gi, 'authorization: Bearer [REDACTED]')
          .replace(/set-cookie:[^\n\r\\"]+/gi, 'set-cookie: [REDACTED]')
          .replace(/"cookie":\s*"[^"]*"/gi, '"cookie":"[REDACTED]"')
          .replace(/"authorization":\s*"[^"]*"/gi, '"authorization":"[REDACTED]"')
          .replace(/"token":\s*"[^"]*"/gi, '"token":"[REDACTED]"');
        return JSON.parse(serialized) as T;
      } catch {
        return data;
      }
    }
    return data;
  }

  private resolveUserDataRoot(): string {
    try {
      if (app && typeof app.getPath === 'function') {
        return app.getPath('userData');
      }
    } catch {
      // In unit test environment without Electron app lifecycle
    }
    return process.cwd();
  }

  private loadProfiles(): void {
    try {
      if (fs.existsSync(this.configFilePath)) {
        const raw = fs.readFileSync(this.configFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        let profileList = parsed.profiles;
        if (typeof parsed.encryptedData === 'string' && parsed.encryptedData) {
          try {
            const decrypted = this.decryptSensitive(parsed.encryptedData);
            if (decrypted) {
              profileList = JSON.parse(decrypted);
            }
          } catch {
            // fallback to plaintext profiles
          }
        }
        if (Array.isArray(profileList)) {
          for (const item of profileList) {
            if (item && typeof item.id === 'string') {
              this.profiles.set(item.id, item);
              this.syncProfileAssignments(item);
            }
          }
        }
        if (typeof parsed.activeProfileId === 'string' && this.profiles.has(parsed.activeProfileId)) {
          this.activeProfileId = parsed.activeProfileId;
        }
      }
    } catch (err) {
      console.warn('[BrowserProfileService] Failed to read profiles from disk, resetting to default:', err);
    }

    if (!this.profiles.has(DEFAULT_BROWSER_PROFILE_ID)) {
      this.profiles.set(DEFAULT_BROWSER_PROFILE_ID, { ...DEFAULT_BROWSER_PROFILE });
    }
    if (!this.profiles.has(this.activeProfileId)) {
      this.activeProfileId = DEFAULT_BROWSER_PROFILE_ID;
    }
  }

  private saveProfiles(): void {
    try {
      const dir = path.dirname(this.configFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const profileList = Array.from(this.profiles.values());
      const encryptedData = this.encryptSensitive(JSON.stringify(profileList));
      const data = {
        activeProfileId: this.activeProfileId,
        profiles: profileList,
        encryptedData: encryptedData.startsWith('safe:') ? encryptedData : undefined,
      };
      fs.writeFileSync(this.configFilePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[BrowserProfileService] Failed to save profiles to disk:', err);
    }
  }

  public getProfiles(): BrowserProfile[] {
    return Array.from(this.profiles.values());
  }

  public getProfile(id: string): BrowserProfile | undefined {
    return this.profiles.get(id);
  }

  public getActiveProfile(): BrowserProfile {
    return this.profiles.get(this.activeProfileId) || this.profiles.get(DEFAULT_BROWSER_PROFILE_ID)!;
  }

  public setActiveProfile(id: string): BrowserProfile {
    const target = this.profiles.get(id);
    if (!target) {
      throw new Error(`Profile not found: ${id}`);
    }
    this.activeProfileId = id;
    this.saveProfiles();
    return target;
  }

  public createProfile(input: CreateProfileInput): BrowserProfile {
    const rawName = (input.name || '').trim();
    if (!rawName) {
      throw new Error('Profile name is required');
    }

    const sanitizedBase = rawName
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 20);

    const suffix = Math.random().toString(36).slice(2, 7);
    const id = sanitizedBase ? `${sanitizedBase}-${suffix}` : `profile-${suffix}`;

    const backend = input.backend || 'embedded';
    const partition = `${BROWSER_PARTITION_PREFIX}${id}`;
    const now = Date.now();

    const externalChromeUserDataDir = path.join(this.userDataRoot, 'chrome-profiles', id);

    const newProfile: BrowserProfile = {
      id,
      name: rawName,
      backend,
      partition,
      mode: input.mode || 'act',
      allowedDomains: input.allowedDomains ? [...input.allowedDomains] : undefined,
      autoApproveActions: input.autoApproveActions ? [...input.autoApproveActions] : undefined,
      assignedTeamIds: input.assignedTeamIds ? [...input.assignedTeamIds] : undefined,
      assignedProjectIds: input.assignedProjectIds ? [...input.assignedProjectIds] : undefined,
      sensitiveUrlPatterns: input.sensitiveUrlPatterns ? [...input.sensitiveUrlPatterns] : undefined,
      sessionHealth: 'healthy',
      externalChrome: {
        port: input.externalChrome?.port || DEFAULT_EXTERNAL_CHROME_PORT,
        userDataDir: input.externalChrome?.userDataDir || externalChromeUserDataDir,
        chromePath: input.externalChrome?.chromePath,
      },
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    };

    this.profiles.set(id, newProfile);
    this.syncProfileAssignments(newProfile);
    this.saveProfiles();
    return newProfile;
  }

  private syncProfileAssignments(profile: BrowserProfile): void {
    const assignmentService = getBrowserAssignmentService();
    if (profile.assignedTeamIds) {
      for (const teamId of profile.assignedTeamIds) {
        assignmentService.assignProfile(profile.id, 'team', teamId);
      }
    }
    if (profile.assignedProjectIds) {
      for (const projectId of profile.assignedProjectIds) {
        assignmentService.assignProfile(profile.id, 'project', projectId);
      }
    }
  }

  public updateProfile(input: UpdateProfileInput): BrowserProfile {
    const existing = this.profiles.get(input.id);
    if (!existing) {
      throw new Error(`Profile not found: ${input.id}`);
    }

    if (input.name) {
      existing.name = input.name.trim();
    }
    if (input.backend) {
      existing.backend = input.backend;
    }
    if (input.mode) {
      existing.mode = input.mode;
    }
    if (input.allowedDomains !== undefined) {
      existing.allowedDomains = input.allowedDomains ? [...input.allowedDomains] : undefined;
    }
    if (input.autoApproveActions !== undefined) {
      existing.autoApproveActions = input.autoApproveActions ? [...input.autoApproveActions] : undefined;
    }
    if (input.assignedTeamIds !== undefined) {
      existing.assignedTeamIds = input.assignedTeamIds ? [...input.assignedTeamIds] : undefined;
    }
    if (input.assignedProjectIds !== undefined) {
      existing.assignedProjectIds = input.assignedProjectIds ? [...input.assignedProjectIds] : undefined;
    }
    if (input.sensitiveUrlPatterns !== undefined) {
      existing.sensitiveUrlPatterns = input.sensitiveUrlPatterns ? [...input.sensitiveUrlPatterns] : undefined;
    }
    if (input.sessionHealth !== undefined) {
      existing.sessionHealth = input.sessionHealth;
    }
    if (input.externalChrome) {
      existing.externalChrome = {
        ...existing.externalChrome,
        ...input.externalChrome,
        port: input.externalChrome.port || existing.externalChrome?.port || DEFAULT_EXTERNAL_CHROME_PORT,
        userDataDir:
          input.externalChrome.userDataDir ||
          existing.externalChrome?.userDataDir ||
          path.join(this.userDataRoot, 'chrome-profiles', existing.id),
      };
    }
    existing.updatedAt = Date.now();

    this.profiles.set(existing.id, existing);
    this.syncProfileAssignments(existing);
    this.saveProfiles();
    return existing;
  }

  public deleteProfile(id: string): boolean {
    if (id === DEFAULT_BROWSER_PROFILE_ID) {
      throw new Error('Cannot delete default profile');
    }
    const profile = this.profiles.get(id);
    if (!profile) {
      return false;
    }

    this.profiles.delete(id);
    if (this.activeProfileId === id) {
      this.activeProfileId = DEFAULT_BROWSER_PROFILE_ID;
    }
    this.saveProfiles();

    // Clean up external Chrome profile directory if applicable
    if (profile.externalChrome?.userDataDir && fs.existsSync(profile.externalChrome.userDataDir)) {
      try {
        fs.rmSync(profile.externalChrome.userDataDir, { recursive: true, force: true });
      } catch (err) {
        console.warn(`[BrowserProfileService] Failed to clean up external Chrome dir for ${id}:`, err);
      }
    }

    return true;
  }

  public async clearProfileData(id: string): Promise<ClearProfileDataResult> {
    const profile = this.profiles.get(id);
    if (!profile) {
      return { success: false, profileId: id, error: `Profile not found: ${id}` };
    }

    try {
      if (session && typeof session.fromPartition === 'function') {
        const targetSession = session.fromPartition(profile.partition);
        await targetSession.clearStorageData();
        await targetSession.clearCache();
        await targetSession.clearAuthCache();
      }

      if (profile.externalChrome?.userDataDir && fs.existsSync(profile.externalChrome.userDataDir)) {
        // Clear caches while preserving the user profile root
        const cacheDir = path.join(profile.externalChrome.userDataDir, 'Default', 'Cache');
        if (fs.existsSync(cacheDir)) {
          fs.rmSync(cacheDir, { recursive: true, force: true });
        }
      }

      return { success: true, profileId: id };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, profileId: id, error: msg };
    }
  }
}

let instance: BrowserProfileService | null = null;

export function getBrowserProfileService(): BrowserProfileService {
  if (!instance) {
    instance = new BrowserProfileService();
  }
  return instance;
}
