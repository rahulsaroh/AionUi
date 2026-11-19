/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Persists the Organization Directory markdown document.
 *
 * Location: `<master root>/.aionui/ORG_DIRECTORY.md` so humans and agents can read it
 * on disk. When no master root is configured, fall back to the app userData folder.
 * Regeneration preserves the "Manual Notes" section written by humans.
 */

import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import { getMasterRoot } from './orgScope';

export const ORG_DIRECTORY_FILE_NAME = 'ORG_DIRECTORY.md';
export const ORG_DIRECTORY_DIR_NAME = '.aionui';
export const MANUAL_NOTES_HEADING = '## Manual Notes';

const AUTO_NOTES_PLACEHOLDER = '<!-- Add durable department notes here';

export async function getOrgDirectoryFilePath(): Promise<string> {
  const masterRoot = await getMasterRoot();
  if (masterRoot) {
    return path.join(masterRoot, ORG_DIRECTORY_DIR_NAME, ORG_DIRECTORY_FILE_NAME);
  }
  const base =
    typeof app !== 'undefined' && app?.getPath ? app.getPath('userData') : path.join(process.cwd(), '.cache');
  return path.join(base, 'org-directory', ORG_DIRECTORY_FILE_NAME);
}

function extractManualNotes(content: string): string | null {
  const index = content.indexOf(`\n${MANUAL_NOTES_HEADING}`);
  if (index === -1) return null;
  return content.slice(index + 1).trimEnd();
}

function hasHumanNotes(section: string | null): boolean {
  if (!section) return false;
  const body = section.split('\n').slice(1).join('\n').trim();
  if (!body) return false;
  return !body.startsWith(AUTO_NOTES_PLACEHOLDER);
}

export function mergeManualNotes(nextContent: string, previousContent: string | null): string {
  if (!previousContent) return nextContent;
  const previousNotes = extractManualNotes(previousContent);
  if (!hasHumanNotes(previousNotes)) return nextContent;

  const nextIndex = nextContent.indexOf(`\n${MANUAL_NOTES_HEADING}`);
  if (nextIndex === -1) return nextContent;
  return `${nextContent.slice(0, nextIndex + 1)}${previousNotes}\n`;
}

export async function readOrgDirectory(): Promise<{ content: string; path: string } | null> {
  const filePath = await getOrgDirectoryFilePath();
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return { content, path: filePath };
  } catch {
    return null;
  }
}

export async function writeOrgDirectory(content: string): Promise<{ success: boolean; path?: string; error?: string }> {
  if (typeof content !== 'string' || !content.trim()) {
    return { success: false, error: 'Organization directory content must be a non-empty string.' };
  }
  if (content.length > 1024 * 1024) {
    return { success: false, error: 'Organization directory content exceeds the 1 MB limit.' };
  }

  const filePath = await getOrgDirectoryFilePath();
  try {
    const previous = await fs.readFile(filePath, 'utf-8').catch((): null => null);
    const merged = mergeManualNotes(content, previous);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, merged, 'utf-8');
    return { success: true, path: filePath };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
