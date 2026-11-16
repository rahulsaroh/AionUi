/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import electron from 'electron';
import fs from 'fs/promises';
import path from 'path';
import type {
  HandbookAssignedRepo,
  HandbookCreateOptions,
  HandbookDetail,
  HandbookHistoryItem,
  HandbookInjectionResult,
  HandbookStatus,
} from '@/common/types/team/handbookTypes';
import { generateHandbookContent } from './handbookTemplates';
import { handbookHistoryManager } from './handbookHistory';
import { handbookWatcher } from './handbookWatcher';
import { computeTokenBudget, estimateTokens, generateInjectionResult } from './handbookPrompt';

const MAPPING_FILE = '.mapping.json';
const ARCHIVE_DIR = '.archive';

type MemberMappingEntry = {
  fileName: string;
  memberName: string;
  role?: string;
  updatedAt: number;
};

type MemberMapping = Record<string, MemberMappingEntry>; // memberKey -> entry

/**
 * Sanitize filename to replace illegal characters on Windows/Linux/macOS:
 * \ / : * ? " < > | and control characters (0-31).
 */
export function sanitizeHandbookFileName(memberName: string): string {
  if (!memberName || !memberName.trim()) {
    return 'member';
  }
  // Replace illegal chars with _
  // oxlint-disable-next-line eslint(no-control-regex)
  let sanitized = memberName.replace(/[\\/:*?"<>|\x00-\x1F]/g, '_');
  // Trim leading/trailing spaces and dots
  sanitized = sanitized.replace(/^[\s.]+|[\s.]+$/g, '');
  if (!sanitized) {
    sanitized = 'member';
  }
  return sanitized;
}

export class HandbookService {
  private customHandbookDir: string | null = null;
  private mappingCache: MemberMapping | null = null;
  // Track last injected hash per conversationId + memberKey: `${conversationId}:${memberKey}` -> hash
  private conversationInjectedHashes: Map<string, string> = new Map();

  constructor(options?: { handbookDir?: string }) {
    if (options?.handbookDir) {
      this.customHandbookDir = options.handbookDir;
    }
  }

  getHandbookDir(): string {
    if (this.customHandbookDir) {
      return this.customHandbookDir;
    }
    const app = electron.app;
    if (app && app.getPath) {
      return path.join(app.getPath('userData'), 'member-handbooks');
    }
    return path.join(process.cwd(), '.cache', 'member-handbooks');
  }

  setHandbookDir(newDir: string): void {
    this.customHandbookDir = newDir;
    this.mappingCache = null;
  }

  async openFolder(): Promise<boolean> {
    const dir = this.getHandbookDir();
    await this.ensureDir(dir);
    try {
      if (electron.shell && electron.shell.openPath) {
        await electron.shell.openPath(dir);
        return true;
      }
    } catch (err) {
      console.warn('[HandbookService] Failed to open handbook directory:', err);
    }
    return false;
  }

  private async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }

  private async loadMapping(): Promise<MemberMapping> {
    if (this.mappingCache) return this.mappingCache;
    const dir = this.getHandbookDir();
    await this.ensureDir(dir);
    const mapPath = path.join(dir, MAPPING_FILE);
    try {
      const raw = await fs.readFile(mapPath, 'utf-8');
      const parsed = JSON.parse(raw) as MemberMapping;
      if (parsed && typeof parsed === 'object') {
        this.mappingCache = parsed;
        return this.mappingCache;
      }
    } catch {
      // ignore
    }
    this.mappingCache = {};
    return this.mappingCache;
  }

  private async saveMapping(mapping: MemberMapping): Promise<void> {
    this.mappingCache = mapping;
    const dir = this.getHandbookDir();
    await this.ensureDir(dir);
    const mapPath = path.join(dir, MAPPING_FILE);
    await fs.writeFile(mapPath, JSON.stringify(mapping, null, 2), 'utf-8');
  }

  /**
   * Resolve an available filename without collisions.
   * If collision occurs, appends " (2)", " (3)", etc.
   */
  async resolveSafeFileName(
    handbookDir: string,
    memberKey: string,
    memberName: string,
    mapping: MemberMapping
  ): Promise<string> {
    const baseStem = sanitizeHandbookFileName(memberName);
    let candidate = `${baseStem}.md`;
    let count = 1;

    while (true) {
      const mappedOwner = Object.entries(mapping).find(([_, entry]) => entry.fileName === candidate)?.[0];
      const filePath = path.join(handbookDir, candidate);
      let diskExists = false;
      try {
        await fs.access(filePath);
        diskExists = true;
      } catch {
        diskExists = false;
      }

      // If neither mapped to another nor on disk, or if mapped to this exact memberKey:
      if ((!mappedOwner || mappedOwner === memberKey) && (!diskExists || mappedOwner === memberKey)) {
        return candidate;
      }

      count++;
      candidate = `${baseStem} (${count}).md`;
    }
  }

  /**
   * Create handbook file for a member.
   */
  async create(options: HandbookCreateOptions): Promise<HandbookDetail> {
    const { memberKey, memberName, role, customContent, seedPrompt, model } = options;
    const dir = this.getHandbookDir();
    await this.ensureDir(dir);

    const mapping = await this.loadMapping();
    const fileName = await this.resolveSafeFileName(dir, memberKey, memberName, mapping);
    const filePath = path.join(dir, fileName);

    const content = generateHandbookContent({
      memberName,
      role,
      customContent,
      seedPrompt,
    });

    await fs.writeFile(filePath, content, 'utf-8');
    const hash = handbookWatcher.computeHash(content);
    handbookWatcher.updateHash(memberKey, hash);

    const now = Date.now();
    mapping[memberKey] = {
      fileName,
      memberName,
      role,
      updatedAt: now,
    };
    await this.saveMapping(mapping);

    // Record initial version in history
    await handbookHistoryManager.recordHistory(dir, memberKey, fileName, content, hash);

    return {
      memberKey,
      memberName,
      role,
      content,
      filePath,
      fileName,
      fileHash: hash,
      updatedAt: now,
      estimatedTokens: estimateTokens(content),
      budgetTokens: computeTokenBudget(model),
    };
  }

  /**
   * Read handbook for a member.
   */
  async read(memberKey: string, model?: string): Promise<HandbookDetail | null> {
    const dir = this.getHandbookDir();
    const mapping = await this.loadMapping();
    const entry = mapping[memberKey];

    let fileName = entry?.fileName;
    if (!fileName) {
      return null;
    }

    const filePath = path.join(dir, fileName);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const hash = handbookWatcher.computeHash(content);

      // Check external disk edit
      if (handbookWatcher.hasExternalEdit(memberKey, hash)) {
        // Disk changed externally, record into history
        await handbookHistoryManager.recordHistory(dir, memberKey, fileName, content, hash);
      }
      handbookWatcher.updateHash(memberKey, hash);

      return {
        memberKey,
        memberName: entry.memberName,
        role: entry.role,
        content,
        filePath,
        fileName,
        fileHash: hash,
        updatedAt: entry.updatedAt || Date.now(),
        estimatedTokens: estimateTokens(content),
        budgetTokens: computeTokenBudget(model),
      };
    } catch {
      return null;
    }
  }

  /**
   * Update handbook content for a member.
   */
  async update(params: { memberKey: string; content: string }): Promise<{ success: boolean; fileHash: string }> {
    const { memberKey, content } = params;
    const dir = this.getHandbookDir();
    const mapping = await this.loadMapping();
    const entry = mapping[memberKey];

    if (!entry) {
      throw new Error(`Handbook not found for memberKey: ${memberKey}`);
    }

    const filePath = path.join(dir, entry.fileName);
    await fs.writeFile(filePath, content, 'utf-8');

    const hash = handbookWatcher.computeHash(content);
    handbookWatcher.updateHash(memberKey, hash);

    entry.updatedAt = Date.now();
    await this.saveMapping(mapping);

    // Save previous version in history
    await handbookHistoryManager.recordHistory(dir, memberKey, entry.fileName, content, hash);

    return { success: true, fileHash: hash };
  }

  /**
   * Rename member: renames file on disk and in mapping, preserving history.
   */
  async rename(params: {
    memberKey: string;
    newMemberName: string;
  }): Promise<{ success: boolean; newFileName: string; newFilePath: string }> {
    const { memberKey, newMemberName } = params;
    const dir = this.getHandbookDir();
    const mapping = await this.loadMapping();
    const entry = mapping[memberKey];

    if (!entry) {
      throw new Error(`Handbook not found for memberKey: ${memberKey}`);
    }

    const oldFilePath = path.join(dir, entry.fileName);
    const newFileName = await this.resolveSafeFileName(dir, memberKey, newMemberName, mapping);
    const newFilePath = path.join(dir, newFileName);

    if (oldFilePath !== newFilePath) {
      try {
        await fs.rename(oldFilePath, newFilePath);
      } catch (err) {
        // If file didn't exist at old path, write fresh
        const content = generateHandbookContent({
          memberName: newMemberName,
          role: entry.role,
        });
        await fs.writeFile(newFilePath, content, 'utf-8');
      }
    }

    entry.fileName = newFileName;
    entry.memberName = newMemberName;
    entry.updatedAt = Date.now();
    await this.saveMapping(mapping);

    await handbookHistoryManager.handleMemberRename(dir, memberKey, newFileName);

    return { success: true, newFileName, newFilePath };
  }

  /**
   * Delete member: archives handbook file into .archive/
   */
  async delete(memberKey: string, archive = true): Promise<{ success: boolean }> {
    const dir = this.getHandbookDir();
    const mapping = await this.loadMapping();
    const entry = mapping[memberKey];

    if (!entry) {
      return { success: true };
    }

    const filePath = path.join(dir, entry.fileName);
    if (archive) {
      const archiveDir = path.join(dir, ARCHIVE_DIR);
      await this.ensureDir(archiveDir);
      const archivePath = path.join(archiveDir, `${Date.now()}-${entry.fileName}`);
      try {
        await fs.rename(filePath, archivePath);
      } catch {
        // If rename fails, try unlinking
        try {
          await fs.unlink(filePath);
        } catch {
          // ignore
        }
      }
    } else {
      try {
        await fs.unlink(filePath);
      } catch {
        // ignore
      }
    }

    delete mapping[memberKey];
    await this.saveMapping(mapping);
    handbookWatcher.remove(memberKey);

    return { success: true };
  }

  /**
   * List all known handbooks.
   */
  async list(): Promise<HandbookDetail[]> {
    const dir = this.getHandbookDir();
    const mapping = await this.loadMapping();
    const results: HandbookDetail[] = [];

    for (const [memberKey, entry] of Object.entries(mapping)) {
      const filePath = path.join(dir, entry.fileName);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const hash = handbookWatcher.computeHash(content);
        results.push({
          memberKey,
          memberName: entry.memberName,
          role: entry.role,
          content,
          filePath,
          fileName: entry.fileName,
          fileHash: hash,
          updatedAt: entry.updatedAt || Date.now(),
          estimatedTokens: estimateTokens(content),
          budgetTokens: 3000,
        });
      } catch {
        // If file missing on disk, skip
      }
    }

    return results;
  }

  /**
   * Get handbook status for a member.
   */
  async getStatus(params: { memberKey: string; memberName?: string }): Promise<HandbookStatus> {
    const { memberKey, memberName = 'teammate' } = params;
    const dir = this.getHandbookDir();

    try {
      await this.ensureDir(dir);
    } catch (err) {
      return {
        memberKey,
        memberName,
        exists: false,
        status: 'error',
        reason: 'Handbook folder is not writable or cannot be created',
      };
    }

    const mapping = await this.loadMapping();
    const entry = mapping[memberKey];

    if (!entry) {
      return {
        memberKey,
        memberName,
        exists: false,
        status: 'not_created',
        reason: 'Handbook has not been created yet',
      };
    }

    const filePath = path.join(dir, entry.fileName);
    try {
      const stats = await fs.stat(filePath);
      const hash = await handbookWatcher.getFileHash(filePath);
      return {
        memberKey,
        memberName: entry.memberName,
        exists: true,
        status: 'created',
        filePath,
        fileName: entry.fileName,
        updatedAt: stats.mtimeMs,
        fileHash: hash || undefined,
      };
    } catch {
      return {
        memberKey,
        memberName: entry.memberName,
        exists: false,
        status: 'not_created',
        reason: 'Handbook file was moved or deleted from disk',
      };
    }
  }

  /**
   * Revert handbook to a previous history version.
   */
  async revert(memberKey: string, historyId: string): Promise<HandbookDetail> {
    const dir = this.getHandbookDir();
    const historyContent = await handbookHistoryManager.getHistoryVersion(dir, memberKey, historyId);
    if (!historyContent) {
      throw new Error(`History version not found: ${historyId}`);
    }

    await this.update({ memberKey, content: historyContent });
    const detail = await this.read(memberKey);
    if (!detail) {
      throw new Error(`Failed to read handbook after revert: ${memberKey}`);
    }
    return detail;
  }

  /**
   * List history versions for a member.
   */
  async listHistory(memberKey: string): Promise<HandbookHistoryItem[]> {
    const dir = this.getHandbookDir();
    return handbookHistoryManager.listHistory(dir, memberKey);
  }

  /**
   * Extension point for Knowledge Repos (Step 8):
   * Updates or replaces the ## Knowledge section in the member's handbook.
   */
  async setKnowledgeSection(
    memberKey: string,
    repos: HandbookAssignedRepo[],
    digest?: string
  ): Promise<{ success: boolean }> {
    const detail = await this.read(memberKey);
    if (!detail) {
      return { success: false };
    }

    let reposText = 'No repositories assigned yet.';
    if (repos && repos.length > 0) {
      reposText = repos
        .map((r) => {
          const refStr = r.ref ? ` (ref: ${r.ref})` : '';
          const commitStr = r.commit ? ` [commit: ${r.commit}]` : '';
          return `- **${r.repoName}**${refStr}${commitStr}`;
        })
        .join('\n');
    }

    const newKnowledgeBlock = `## Knowledge\n### Assigned Repositories\n${reposText}\n\n### Notes\n${
      digest?.trim() || 'Attached knowledge repositories.'
    }`;

    let updatedContent: string;
    const lines = detail.content.split('\n');
    const knowledgeIndex = lines.findIndex((l) => l.trim().startsWith('## Knowledge'));
    const nextH2Index = lines.findIndex(
      (l, idx) => idx > knowledgeIndex && knowledgeIndex !== -1 && l.trim().startsWith('## ')
    );

    if (knowledgeIndex !== -1) {
      const before = lines.slice(0, knowledgeIndex).join('\n');
      const after = nextH2Index !== -1 ? '\n\n' + lines.slice(nextH2Index).join('\n') : '';
      updatedContent = `${before}\n\n${newKnowledgeBlock}${after}`.trim();
    } else {
      // Append before Lessons Learned or at end
      const lessonsIndex = lines.findIndex((l) => l.trim().startsWith('## Lessons Learned'));
      if (lessonsIndex !== -1) {
        const before = lines.slice(0, lessonsIndex).join('\n');
        const after = lines.slice(lessonsIndex).join('\n');
        updatedContent = `${before}\n\n${newKnowledgeBlock}\n\n${after}`.trim();
      } else {
        updatedContent = `${detail.content}\n\n${newKnowledgeBlock}`.trim();
      }
    }

    await this.update({ memberKey, content: updatedContent });
    return { success: true };
  }

  /**
   * Build the prompt block to inject into the agent.
   * Full block on first message, one-line reminder afterwards, full block again when file hash changes.
   */
  async getInjectedBlock(params: {
    memberKey: string;
    conversationId?: string;
    isFirstMessage?: boolean;
    model?: string;
  }): Promise<HandbookInjectionResult | null> {
    const { memberKey, conversationId, isFirstMessage, model } = params;
    const detail = await this.read(memberKey, model);
    if (!detail) {
      return null;
    }

    const convKey = conversationId ? `${conversationId}:${memberKey}` : memberKey;
    const lastHash = this.conversationInjectedHashes.get(convKey);
    const hashChanged = !lastHash || lastHash !== detail.fileHash;

    const shouldSendFullBlock = isFirstMessage !== undefined ? isFirstMessage || hashChanged : hashChanged;

    const result = generateInjectionResult({
      memberName: detail.memberName,
      role: detail.role,
      content: detail.content,
      fileHash: detail.fileHash,
      isFirstMessage: shouldSendFullBlock,
      model,
    });

    // Record injected hash for this conversation
    this.conversationInjectedHashes.set(convKey, detail.fileHash);

    return result;
  }
}

export const handbookService = new HandbookService();
