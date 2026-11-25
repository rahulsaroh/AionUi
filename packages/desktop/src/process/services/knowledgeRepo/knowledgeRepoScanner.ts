/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs/promises';
import path from 'path';
import type {
  KnowledgeRepoManifest,
  KnowledgeRuleItem,
  KnowledgeSkillItem,
  KnowledgeSetupFile,
} from '@/common/types/knowledgeRepo';

const MAX_RULE_FILE_SIZE = 128 * 1024; // 128 KB max per always-on rule file
const MAX_README_FALLBACK_CHARS = 8000;
const MAX_REPO_MAP_CHARS = 2500;
const MAX_REPO_MAP_ENTRIES = 150;
const MAX_SKILL_SCAN_DEPTH = 4;
const MAX_SKILLS_COUNT = 200;
const MAX_WORKFLOW_SCAN_DEPTH = 3;
const MAX_WORKFLOW_COUNT = 100;

const IGNORED_MAP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.venv',
  'venv',
  '__pycache__',
  'target',
  '.next',
  '.cache',
]);

// Common rule filename patterns (ordered by precedence)
const ALWAYS_ON_RULE_FILES: Array<{ path: string; priority: number }> = [
  { path: 'AGENTS.md', priority: 10 },
  { path: 'AGENT_GUIDE.md', priority: 10 },
  { path: 'CLAUDE.md', priority: 10 },
  { path: 'GEMINI.md', priority: 10 },
  { path: '.cursorrules', priority: 10 },
  { path: '.windsurfrules', priority: 10 },
  { path: '.github/copilot-instructions.md', priority: 10 },
  { path: 'COPILOT_INSTRUCTIONS.md', priority: 9 },
  { path: 'ARCHITECTURE.md', priority: 6 },
  { path: 'CONTRIBUTING.md', priority: 6 },
];

// Folders containing rule files
const RULE_DIRECTORIES = ['.cursor/rules'];

// Skill directory search roots
const SKILL_DIRECTORIES = ['.claude/skills', 'skills', '.agents', '.agent'];

// Workflows / pipelines directories
const WORKFLOW_DIRECTORIES = ['pipelines', 'pipeline_defs', 'workflows', 'docs'];

// Documentation & workflow file extensions
const WORKFLOW_EXTENSIONS = new Set(['.md', '.mdx', '.yaml', '.yml', '.json', '.txt', '.rst']);

// Setup and environment files that may alter runtime or execute code
const SETUP_FILE_PATTERNS: Array<{
  pattern: RegExp;
  type: KnowledgeSetupFile['type'];
  defaultBinaries?: string[];
}> = [
  { pattern: /^Makefile$/i, type: 'makefile', defaultBinaries: ['make'] },
  { pattern: /^setup\.(sh|bash|py)$/i, type: 'script' },
  { pattern: /^requirements.*\.txt$/i, type: 'dependency', defaultBinaries: ['python', 'pip'] },
  { pattern: /^package\.json$/i, type: 'dependency', defaultBinaries: ['node', 'npm'] },
  { pattern: /^Pipfile(\.lock)?$/i, type: 'dependency', defaultBinaries: ['pipenv'] },
  { pattern: /^pyproject\.toml$/i, type: 'dependency', defaultBinaries: ['python'] },
  { pattern: /^\.env\.example$/i, type: 'env_example' },
];

export class KnowledgeRepoScanner {
  /**
   * Scans a repository directory (or subpath) and builds a KnowledgeRepoManifest.
   */
  async scan(baseDir: string, subpath?: string): Promise<KnowledgeRepoManifest> {
    const root = subpath ? path.join(baseDir, subpath) : baseDir;

    const alwaysOnRules: KnowledgeRuleItem[] = [];
    const onDemandSkills: KnowledgeSkillItem[] = [];
    const setupFiles: KnowledgeSetupFile[] = [];
    const envExampleVars: string[] = [];

    // 1. Scan always-on instruction files in root
    for (const ruleSpec of ALWAYS_ON_RULE_FILES) {
      const ruleRel = ruleSpec.path;
      const fullPath = path.join(root, ruleRel);
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isFile()) {
          const rawContent = await fs.readFile(fullPath, 'utf8');
          const sizeBytes = stat.size;
          const content =
            sizeBytes > MAX_RULE_FILE_SIZE
              ? `${rawContent.slice(0, MAX_RULE_FILE_SIZE)}\n\n[TRUNCATED: Rule file exceeded budget]`
              : rawContent;

          alwaysOnRules.push({
            id: ruleRel.replace(/[^a-zA-Z0-9_-]/g, '_'),
            name: path.basename(ruleRel),
            relativePath: ruleRel,
            content,
            sizeBytes,
            priority: ruleSpec.priority,
          });
        }
      } catch {
        // File does not exist, ignore
      }
    }

    // 2. Scan rule directories (e.g. .cursor/rules/*)
    for (const dirRel of RULE_DIRECTORIES) {
      const fullDir = path.join(root, dirRel);
      try {
        const entries = await fs.readdir(fullDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile()) {
            const relPath = path.join(dirRel, entry.name).replace(/\\/g, '/');
            const fullPath = path.join(fullDir, entry.name);
            const stat = await fs.stat(fullPath);
            const rawContent = await fs.readFile(fullPath, 'utf8');
            alwaysOnRules.push({
              id: relPath.replace(/[^a-zA-Z0-9_-]/g, '_'),
              name: entry.name,
              relativePath: relPath,
              content: rawContent,
              sizeBytes: stat.size,
              priority: 5,
            });
          }
        }
      } catch {
        // Directory does not exist
      }
    }

    // 3. Recursively scan on-demand skills for SKILL.md
    for (const skillDirRel of SKILL_DIRECTORIES) {
      const fullSkillDir = path.join(root, skillDirRel);
      await this.scanSkillsRecursive(root, fullSkillDir, skillDirRel, 0, onDemandSkills);
    }

    // 4. Recursively scan workflow / pipeline / docs directories
    for (const wfDir of WORKFLOW_DIRECTORIES) {
      const fullWfDir = path.join(root, wfDir);
      await this.scanWorkflowsRecursive(root, fullWfDir, wfDir, 0, onDemandSkills);
    }

    // 5. Fallback: If no rules or skills found, check README files (case-insensitive)
    if (alwaysOnRules.length === 0 && onDemandSkills.length === 0) {
      const readmeCandidate = await this.findReadmeFile(root);
      if (readmeCandidate) {
        try {
          const stat = await fs.stat(readmeCandidate.fullPath);
          if (stat.isFile()) {
            const raw = await fs.readFile(readmeCandidate.fullPath, 'utf8');
            alwaysOnRules.push({
              id: 'readme_fallback',
              name: readmeCandidate.name,
              relativePath: readmeCandidate.name,
              content: raw.slice(0, MAX_README_FALLBACK_CHARS),
              sizeBytes: Math.min(stat.size, MAX_README_FALLBACK_CHARS),
              priority: 1,
            });
          }
        } catch {
          // Ignore unreadable README
        }
      }
    }

    // 6. Detect setup files & scripts
    try {
      const rootEntries = await fs.readdir(root, { withFileTypes: true });
      for (const entry of rootEntries) {
        if (!entry.isFile()) continue;
        for (const match of SETUP_FILE_PATTERNS) {
          if (match.pattern.test(entry.name)) {
            const relPath = entry.name;
            const setupItem: KnowledgeSetupFile = {
              relativePath: relPath,
              type: match.type,
              requiredBinaries: match.defaultBinaries,
            };

            if (entry.name === '.env.example') {
              try {
                const envContent = await fs.readFile(path.join(root, entry.name), 'utf8');
                const vars = envContent
                  .split('\n')
                  .map((line) => line.trim())
                  .filter((line) => line && !line.startsWith('#') && line.includes('='))
                  .map((line) => line.split('=')[0].trim());
                envExampleVars.push(...vars);
              } catch {
                // Ignore .env.example read errors
              }
            }

            setupFiles.push(setupItem);
          }
        }
      }
    } catch {
      // Ignore root entry scan failure
    }

    // 7. Build compact directory tree map for general code/docs repos
    const repoMap = await this.buildRepoMap(root);

    // Calculate approximate token estimate (1 token ~= 4 chars)
    let totalChars = repoMap ? repoMap.length : 0;
    for (const rule of alwaysOnRules) {
      totalChars += rule.content.length;
    }
    for (const skill of onDemandSkills) {
      totalChars += skill.name.length + skill.description.length + skill.relativePath.length;
    }
    const estimatedTokens = Math.ceil(totalChars / 4);

    return {
      alwaysOnRules,
      onDemandSkills,
      setupFiles,
      envExampleVars: Array.from(new Set(envExampleVars)),
      repoMap: repoMap || undefined,
      summary: `Discovered ${alwaysOnRules.length} rules, ${onDemandSkills.length} skills/workflows, ${setupFiles.length} setup files.`,
      estimatedTokens,
    };
  }

  private async scanSkillsRecursive(
    repoRoot: string,
    currentDir: string,
    category: string,
    depth: number,
    results: KnowledgeSkillItem[]
  ): Promise<void> {
    if (depth > MAX_SKILL_SCAN_DEPTH || results.length >= MAX_SKILLS_COUNT) return;
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (results.length >= MAX_SKILLS_COUNT) break;
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;

      const subDir = path.join(currentDir, entry.name);
      const skillMdPath = path.join(subDir, 'SKILL.md');
      try {
        const content = await fs.readFile(skillMdPath, 'utf8');
        const { name, description } = this.parseSkillFrontmatter(content, entry.name);
        const relPath = path.relative(repoRoot, skillMdPath).replace(/\\/g, '/');
        results.push({
          id: relPath.replace(/[^a-zA-Z0-9_-]/g, '_'),
          name,
          description,
          relativePath: relPath,
          category,
        });
      } catch {
        // Recurse into nested subdirectories to locate SKILL.md
        await this.scanSkillsRecursive(repoRoot, subDir, category, depth + 1, results);
      }
    }
  }

  private async scanWorkflowsRecursive(
    repoRoot: string,
    currentDir: string,
    category: string,
    depth: number,
    results: KnowledgeSkillItem[]
  ): Promise<void> {
    if (depth > MAX_WORKFLOW_SCAN_DEPTH || results.length >= MAX_SKILLS_COUNT + MAX_WORKFLOW_COUNT) return;
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (results.length >= MAX_SKILLS_COUNT + MAX_WORKFLOW_COUNT) break;
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await this.scanWorkflowsRecursive(repoRoot, fullPath, category, depth + 1, results);
      } else if (entry.isFile() && WORKFLOW_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const relPath = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
        results.push({
          id: relPath.replace(/[^a-zA-Z0-9_-]/g, '_'),
          name: entry.name,
          description: `Documentation / workflow file in ${relPath}`,
          relativePath: relPath,
          category,
        });
      }
    }
  }

  private async findReadmeFile(root: string): Promise<{ name: string; fullPath: string } | null> {
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      const preferred = ['readme.md', 'readme.mdx', 'readme.rst', 'readme.txt', 'readme'];
      for (const target of preferred) {
        const match = entries.find((e) => e.isFile() && e.name.toLowerCase() === target);
        if (match) {
          return { name: match.name, fullPath: path.join(root, match.name) };
        }
      }
    } catch {
      // Ignore
    }
    return null;
  }

  private async buildRepoMap(root: string): Promise<string> {
    const lines: string[] = [];
    let totalChars = 0;

    const walk = async (dir: string, depth: number, prefix: string): Promise<void> => {
      if (depth > 3 || lines.length >= MAX_REPO_MAP_ENTRIES || totalChars >= MAX_REPO_MAP_CHARS) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      for (const entry of entries) {
        if (lines.length >= MAX_REPO_MAP_ENTRIES || totalChars >= MAX_REPO_MAP_CHARS) break;
        if (entry.isSymbolicLink() || IGNORED_MAP_DIRS.has(entry.name)) continue;
        const isDir = entry.isDirectory();
        const line = `${prefix}${entry.name}${isDir ? '/' : ''}`;
        if (totalChars + line.length + 1 > MAX_REPO_MAP_CHARS) break;
        lines.push(line);
        totalChars += line.length + 1;
        if (isDir) {
          await walk(path.join(dir, entry.name), depth + 1, `${prefix}  `);
        }
      }
    };

    await walk(root, 1, '');
    return lines.join('\n');
  }

  /**
   * Parse frontmatter from SKILL.md
   */
  private parseSkillFrontmatter(content: string, defaultName: string): { name: string; description: string } {
    let name = defaultName;
    let description = `Skill defined in ${defaultName}`;

    if (content.startsWith('---')) {
      const parts = content.split('---');
      if (parts.length >= 3) {
        const fm = parts[1];
        const lines = fm.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('name:')) {
            name = trimmed
              .replace('name:', '')
              .trim()
              .replace(/^['"]|['"]$/g, '');
          } else if (trimmed.startsWith('description:')) {
            description = trimmed
              .replace('description:', '')
              .trim()
              .replace(/^['"]|['"]$/g, '');
          }
        }
      }
    }
    return { name, description };
  }
}

export const knowledgeRepoScanner = new KnowledgeRepoScanner();
