import fs from 'node:fs';
import path from 'node:path';
import { assertWithinScope } from './pathGuard';

export type DiscoveredProject = {
  name: string;
  path: string;
  projectType?: string;
  description?: string;
};

const IGNORED_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '.cache',
  'temp',
  'tmp',
  '.git',
  '.svn',
  '.hg',
  '.vscode',
  '.idea',
]);

const PROJECT_MARKERS: Array<{ file: string; type: string }> = [
  { file: 'package.json', type: 'Node / Web' },
  { file: 'Cargo.toml', type: 'Rust' },
  { file: 'go.mod', type: 'Go' },
  { file: 'pyproject.toml', type: 'Python' },
  { file: 'requirements.txt', type: 'Python' },
  { file: 'Pipfile', type: 'Python' },
  { file: 'pom.xml', type: 'Java (Maven)' },
  { file: 'build.gradle', type: 'Java / Kotlin (Gradle)' },
  { file: 'build.gradle.kts', type: 'Kotlin (Gradle)' },
  { file: 'composer.json', type: 'PHP' },
  { file: 'Gemfile', type: 'Ruby' },
  { file: 'pubspec.yaml', type: 'Flutter / Dart' },
  { file: 'CMakeLists.txt', type: 'C / C++' },
  { file: 'Makefile', type: 'Make' },
  { file: '.project.json', type: 'Org Project' },
  { file: '.department.json', type: 'Org Department' },
  { file: '.git', type: 'Git Repository' },
];

export async function discoverProjectsInFolder(targetPath: string, allowedRoot?: string): Promise<DiscoveredProject[]> {
  if (!targetPath) return [];

  if (allowedRoot) {
    const scopeCheck = await assertWithinScope(targetPath, allowedRoot);
    if (!scopeCheck.allowed) {
      return [];
    }
  }

  let resolvedPath = path.resolve(targetPath);
  try {
    resolvedPath = fs.realpathSync(resolvedPath);
  } catch {
    // Virtual or cloud filesystems (e.g. Google Drive, network mounts) may throw in realpathSync; fall back to path.resolve
  }

  if (!fs.existsSync(resolvedPath)) {
    return [];
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolvedPath);
  } catch {
    return [];
  }
  if (!stat.isDirectory()) return [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: DiscoveredProject[] = [];

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    if (IGNORED_DIR_NAMES.has(entry.name.toLowerCase())) continue;

    const subPath = path.join(resolvedPath, entry.name);

    let detectedType: string | undefined;
    let customName: string | undefined;

    for (const marker of PROJECT_MARKERS) {
      const markerPath = path.join(subPath, marker.file);
      try {
        if (fs.existsSync(markerPath)) {
          detectedType = marker.type;
          if (marker.file === 'package.json') {
            try {
              const rawPkg = fs.readFileSync(markerPath, 'utf-8');
              const pkg = JSON.parse(rawPkg) as { name?: unknown };
              if (typeof pkg.name === 'string' && pkg.name.trim()) {
                customName = pkg.name.trim();
              }
            } catch {
              // ignore json parse error
            }
          }
          break;
        }
      } catch {
        // ignore fs error
      }
    }

    const projectName = customName || entry.name;
    results.push({
      name: projectName,
      path: subPath,
      projectType: detectedType || 'Directory Project',
      description: detectedType ? `${detectedType} project at ${subPath}` : `Project located at ${subPath}`,
    });
  }

  return results;
}
