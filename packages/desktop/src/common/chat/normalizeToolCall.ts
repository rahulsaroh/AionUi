import { createTwoFilesPatch } from 'diff';
import type { IMessageAcpToolCall, IMessageToolCall, IMessageToolGroup } from './chatLib';
import { getAcpImagePath } from './acpToolCallOutput';

export type NormalizedToolStatus = 'pending' | 'running' | 'completed' | 'error' | 'canceled';

export type NormalizedToolCategory = 'explore' | 'command' | 'edit' | 'other';

export type NormalizedExploreAction = 'analyzed' | 'searched' | 'listed';

export type NormalizedFileChangeAction = 'created' | 'edited' | 'modified';

export interface NormalizedFileChange {
  fileName: string;
  fullPath: string;
  action: NormalizedFileChangeAction;
  insertions: number;
  deletions: number;
  diff?: string;
}

export interface NormalizedToolCall {
  key: string;
  name: string;
  status: NormalizedToolStatus;
  description?: string;
  input?: string;
  output?: string;
  truncated?: boolean;
  messageId?: string;
  conversationId?: string;
  imagePath?: string;
  category?: NormalizedToolCategory;
  exploreAction?: NormalizedExploreAction;
  filePath?: string;
  lineRange?: string;
  fileChanges?: NormalizedFileChange[];
}

const formatValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const getBaseName = (filePath: string): string => filePath.split(/[/\\]/).pop() || filePath;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const firstString = (raw: Record<string, unknown> | undefined, keys: string[]): string | undefined => {
  if (!raw) return undefined;
  for (const key of keys) {
    const val = raw[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return undefined;
};

const firstFiniteNumber = (raw: Record<string, unknown> | undefined, keys: string[]): number | undefined => {
  if (!raw) return undefined;
  for (const key of keys) {
    const val = raw[key];
    if (typeof val === 'number' && Number.isFinite(val)) {
      return val;
    }
  }
  return undefined;
};

export const countDiffStats = (diffText: string): { insertions: number; deletions: number } => {
  let insertions = 0;
  let deletions = 0;
  const lines = diffText.split('\n');
  for (const line of lines) {
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('---') ||
      line.startsWith('+++') ||
      line.startsWith('@@') ||
      line.startsWith('\\')
    ) {
      continue;
    }
    if (line.startsWith('+')) {
      insertions++;
    } else if (line.startsWith('-')) {
      deletions++;
    }
  }
  return { insertions, deletions };
};

const isUnifiedDiff = (text: string): boolean =>
  text.includes('@@ ') && (text.includes('+++ ') || text.includes('--- ') || text.includes('diff --git'));

const buildPatchAndStats = (
  filePath: string,
  oldText: string,
  newText: string
): { diff: string; insertions: number; deletions: number } => {
  const fileName = getBaseName(filePath);
  const diff = createTwoFilesPatch(fileName, fileName, oldText, newText, '', '', { context: 3 });
  const { insertions, deletions } = countDiffStats(diff);
  return { diff, insertions, deletions };
};

const EDIT_TOOL_NAME_RE =
  /^(?:writefile|write_file|write_to_file|write|create_file|edit|edit_file|multiedit|multi_edit|replace|replace_file_content|multi_replace_file_content|patch|apply_patch|notebookedit)$/i;

const CREATE_TOOL_NAME_RE = /^(?:writefile|write_file|write_to_file|write|create_file)$/i;

const COMMAND_TOOL_NAME_RE =
  /^(?:bash|shell|execute|exec|run_command|shell command|terminal|command_status|send_command_input)$/i;

const EXPLORE_TOOL_NAME_RE =
  /^(?:read|readfile|read_file|view_file|view_file_outline|view_code_item|grep|grep_search|ripgrep|rg|glob|find|find_by_name|list|ls|list_dir|search|codebase_search)$/i;

const SEARCH_TOOL_NAME_RE = /(?:grep|search|find|glob|\brg\b)/i;
const LIST_TOOL_NAME_RE = /^(?:list|ls|list_dir|listdir)$/i;

const looksLikeEditTool = (name: string): boolean => {
  const normalized = name.trim();
  if (EDIT_TOOL_NAME_RE.test(normalized)) return true;
  const lower = normalized.toLowerCase();
  return (
    lower.includes('edit file') ||
    lower.includes('write file') ||
    lower.includes('create file') ||
    lower.includes('modify file')
  );
};

const looksLikeCreateTool = (name: string): boolean => {
  const normalized = name.trim();
  if (CREATE_TOOL_NAME_RE.test(normalized)) return true;
  const lower = normalized.toLowerCase();
  return lower.includes('create file') || lower.includes('write file');
};

const looksLikeCommandTool = (name: string): boolean => {
  const normalized = name.trim();
  if (COMMAND_TOOL_NAME_RE.test(normalized)) return true;
  const lower = normalized.toLowerCase();
  return lower.includes('command') || lower.includes('terminal') || lower.includes('shell');
};

const looksLikeExploreTool = (name: string): boolean => {
  const normalized = name.trim();
  if (EXPLORE_TOOL_NAME_RE.test(normalized)) return true;
  const lower = normalized.toLowerCase();
  return lower.includes('read') || lower.includes('search') || lower.includes('grep') || lower.includes('glob');
};

const classifyCategory = (
  name: string,
  kind?: string,
  confirmationType?: string,
  hasFileChanges?: boolean
): NormalizedToolCategory => {
  if (hasFileChanges || confirmationType === 'edit' || kind === 'edit' || kind === 'write') {
    return 'edit';
  }
  if (confirmationType === 'exec' || kind === 'execute') {
    return 'command';
  }
  if (kind === 'read' || kind === 'search' || kind === 'grep' || kind === 'glob' || kind === 'list') {
    return 'explore';
  }
  if (looksLikeEditTool(name)) return 'edit';
  if (looksLikeCommandTool(name)) return 'command';
  if (looksLikeExploreTool(name)) return 'explore';
  return 'other';
};

const classifyExploreAction = (name: string, kind?: string): NormalizedExploreAction => {
  if (kind === 'search' || kind === 'grep' || kind === 'glob' || SEARCH_TOOL_NAME_RE.test(name)) {
    return 'searched';
  }
  if (kind === 'list' || LIST_TOOL_NAME_RE.test(name)) {
    return 'listed';
  }
  return 'analyzed';
};

const extractLineRange = (raw?: Record<string, unknown>): string | undefined => {
  if (!raw) return undefined;

  const viewRange = raw.view_range;
  if (Array.isArray(viewRange) && viewRange.length >= 2) {
    const start = Number(viewRange[0]);
    const end = Number(viewRange[1]);
    if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
      return `#L${start}-${end}`;
    }
  }

  const startLine = firstFiniteNumber(raw, ['StartLine', 'start_line', 'startLine']);
  const endLine = firstFiniteNumber(raw, ['EndLine', 'end_line', 'endLine']);
  if (startLine !== undefined && endLine !== undefined && endLine >= startLine) {
    return `#L${startLine}-${endLine}`;
  }

  const offset = firstFiniteNumber(raw, ['offset', 'start']);
  const limit = firstFiniteNumber(raw, ['limit', 'line_count']);
  if (offset !== undefined && limit !== undefined && limit > 0) {
    const start = offset <= 0 ? 1 : offset;
    return `#L${start}-${start + limit - 1}`;
  }
  if (limit !== undefined && limit > 0) {
    return `#L1-${limit}`;
  }

  return undefined;
};

const FILE_PATH_INPUT_KEYS = ['file_path', 'path', 'file_name', 'target_file', 'TargetFile', 'AbsolutePath'];

const extractFileChangesFromInput = (
  name: string,
  raw?: Record<string, unknown>,
  locations?: Array<{ path?: string }>
): NormalizedFileChange[] => {
  const filePath =
    firstString(raw, FILE_PATH_INPUT_KEYS) || locations?.find((loc) => typeof loc?.path === 'string')?.path;
  if (!filePath) return [];
  const fileName = getBaseName(filePath);

  if (raw && Array.isArray(raw.edits)) {
    let insertions = 0;
    let deletions = 0;
    const patches: string[] = [];
    for (const edit of raw.edits) {
      if (!isRecord(edit)) continue;
      const oldText =
        typeof edit.old_string === 'string' ? edit.old_string : typeof edit.old_text === 'string' ? edit.old_text : '';
      const newText =
        typeof edit.new_string === 'string' ? edit.new_string : typeof edit.new_text === 'string' ? edit.new_text : '';
      if (!oldText && !newText) continue;
      const stats = buildPatchAndStats(filePath, oldText, newText);
      insertions += stats.insertions;
      deletions += stats.deletions;
      patches.push(stats.diff);
    }
    if (patches.length > 0) {
      return [
        {
          fileName,
          fullPath: filePath,
          action: 'edited',
          insertions,
          deletions,
          diff: patches.join('\n'),
        },
      ];
    }
  }

  if (raw && Array.isArray(raw.ReplacementChunks)) {
    let insertions = 0;
    let deletions = 0;
    const patches: string[] = [];
    for (const chunk of raw.ReplacementChunks) {
      if (!isRecord(chunk)) continue;
      const oldText = typeof chunk.TargetContent === 'string' ? chunk.TargetContent : '';
      const newText = typeof chunk.ReplacementContent === 'string' ? chunk.ReplacementContent : '';
      if (!oldText && !newText) continue;
      const stats = buildPatchAndStats(filePath, oldText, newText);
      insertions += stats.insertions;
      deletions += stats.deletions;
      patches.push(stats.diff);
    }
    if (patches.length > 0) {
      return [
        {
          fileName,
          fullPath: filePath,
          action: 'edited',
          insertions,
          deletions,
          diff: patches.join('\n'),
        },
      ];
    }
  }

  if (raw) {
    const oldText =
      typeof raw.old_string === 'string'
        ? raw.old_string
        : typeof raw.old_text === 'string'
          ? raw.old_text
          : typeof raw.TargetContent === 'string'
            ? raw.TargetContent
            : undefined;
    const newText =
      typeof raw.new_string === 'string'
        ? raw.new_string
        : typeof raw.new_text === 'string'
          ? raw.new_text
          : typeof raw.ReplacementContent === 'string'
            ? raw.ReplacementContent
            : undefined;

    if (oldText !== undefined || newText !== undefined) {
      const resolvedOld = oldText ?? '';
      const resolvedNew = newText ?? '';
      const stats = buildPatchAndStats(filePath, resolvedOld, resolvedNew);
      return [
        {
          fileName,
          fullPath: filePath,
          action: resolvedOld.length === 0 && resolvedNew.length > 0 ? 'created' : 'edited',
          insertions: stats.insertions,
          deletions: stats.deletions,
          diff: stats.diff,
        },
      ];
    }

    const writeContent =
      typeof raw.content === 'string'
        ? raw.content
        : typeof raw.CodeContent === 'string'
          ? raw.CodeContent
          : typeof raw.text === 'string'
            ? raw.text
            : undefined;
    if (writeContent !== undefined && looksLikeEditTool(name)) {
      const stats = buildPatchAndStats(filePath, '', writeContent);
      const isOverwrite = raw.Overwrite === true || raw.overwrite === true;
      return [
        {
          fileName,
          fullPath: filePath,
          action: isOverwrite ? 'modified' : 'created',
          insertions: stats.insertions,
          deletions: stats.deletions,
          diff: stats.diff,
        },
      ];
    }
  }

  if (looksLikeEditTool(name)) {
    return [
      {
        fileName,
        fullPath: filePath,
        action: looksLikeCreateTool(name) ? 'created' : 'edited',
        insertions: 0,
        deletions: 0,
      },
    ];
  }

  return [];
};

const isCreatedDiff = (diffText: string, toolName: string, deletions: number): boolean => {
  if (diffText.includes('--- /dev/null') || diffText.includes('new file mode')) {
    return true;
  }
  return deletions === 0 && looksLikeCreateTool(toolName);
};

// ===== tool_group → NormalizedToolCall[] =====

function normalizeToolGroupStatus(status: string): NormalizedToolStatus {
  switch (status) {
    case 'Success':
      return 'completed';
    case 'Error':
      return 'error';
    case 'Canceled':
      return 'canceled';
    case 'Pending':
      return 'pending';
    case 'Executing':
    case 'Confirming':
    default:
      return 'running';
  }
}

const getResultDisplayText = (
  result_display: IMessageToolGroup['content'][0]['result_display']
): string | undefined => {
  if (!result_display) return undefined;
  if (typeof result_display === 'string') return result_display;
  if ('file_diff' in result_display) return result_display.file_diff;
  if ('img_url' in result_display) return result_display.relative_path || result_display.img_url;
  return undefined;
};

export function normalizeToolGroup(message: IMessageToolGroup): NormalizedToolCall[] {
  if (!Array.isArray(message.content)) return [];
  return message.content.map(({ name, call_id, description, confirmationDetails, status, result_display }) => {
    let desc = typeof description === 'string' ? description.slice(0, 120) : '';
    const type = confirmationDetails?.type;
    if (type === 'edit') desc = confirmationDetails.file_name;
    if (type === 'exec') desc = confirmationDetails.command;
    if (type === 'info') desc = confirmationDetails.urls?.join(';') || confirmationDetails.title;
    if (type === 'mcp') desc = confirmationDetails.server_name + ':' + confirmationDetails.tool_name;

    let input: string | undefined;
    if (confirmationDetails) {
      const { title: _title, type: _type, ...rest } = confirmationDetails;
      if (Object.keys(rest).length) input = formatValue(rest);
    } else if (description) {
      input = description;
    }

    const fileChanges: NormalizedFileChange[] = [];
    if (
      result_display &&
      typeof result_display === 'object' &&
      'file_diff' in result_display &&
      result_display.file_diff
    ) {
      const fullPath = result_display.file_name || desc || 'unknown';
      const stats = countDiffStats(result_display.file_diff);
      fileChanges.push({
        fileName: getBaseName(fullPath),
        fullPath,
        action: isCreatedDiff(result_display.file_diff, name, stats.deletions) ? 'created' : 'edited',
        insertions: stats.insertions,
        deletions: stats.deletions,
        diff: result_display.file_diff,
      });
    } else if (confirmationDetails?.type === 'edit' && confirmationDetails.file_diff) {
      const fullPath = confirmationDetails.file_name;
      const stats = countDiffStats(confirmationDetails.file_diff);
      fileChanges.push({
        fileName: getBaseName(fullPath),
        fullPath,
        action:
          confirmationDetails.isModifying === false ||
          isCreatedDiff(confirmationDetails.file_diff, name, stats.deletions)
            ? 'created'
            : 'edited',
        insertions: stats.insertions,
        deletions: stats.deletions,
        diff: confirmationDetails.file_diff,
      });
    } else if (typeof result_display === 'string' && isUnifiedDiff(result_display) && looksLikeEditTool(name)) {
      const fullPath = desc || 'unknown';
      const stats = countDiffStats(result_display);
      fileChanges.push({
        fileName: getBaseName(fullPath),
        fullPath,
        action: isCreatedDiff(result_display, name, stats.deletions) ? 'created' : 'edited',
        insertions: stats.insertions,
        deletions: stats.deletions,
        diff: result_display,
      });
    } else if (looksLikeEditTool(name) && desc && !desc.includes(' ')) {
      fileChanges.push({
        fileName: getBaseName(desc),
        fullPath: desc,
        action: looksLikeCreateTool(name) ? 'created' : 'edited',
        insertions: 0,
        deletions: 0,
      });
    }

    const category = classifyCategory(name, undefined, type, fileChanges.length > 0);
    const exploreAction = category === 'explore' ? classifyExploreAction(name) : undefined;
    const filePath =
      fileChanges[0]?.fullPath ||
      (category === 'explore' && exploreAction === 'analyzed' && desc && !desc.includes(' ') ? desc : undefined);

    return {
      key: call_id,
      name,
      status: normalizeToolGroupStatus(status),
      description: desc,
      input,
      output: getResultDisplayText(result_display),
      category,
      exploreAction,
      filePath,
      fileChanges: fileChanges.length > 0 ? fileChanges : undefined,
    };
  });
}

// ===== acp_tool_call → NormalizedToolCall =====

function normalizeAcpStatus(status: string): NormalizedToolStatus {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'error';
    case 'in_progress':
      return 'running';
    case 'pending':
    default:
      return 'pending';
  }
}

const buildParamSummary = (kind: string, rawInput?: Record<string, unknown>): string | undefined => {
  if (!rawInput) return undefined;

  if (kind === 'read' || kind === 'edit' || kind === 'write') {
    return firstString(rawInput, FILE_PATH_INPUT_KEYS);
  }
  if (kind === 'execute') {
    return (rawInput.command as string) || (rawInput.cmd as string);
  }
  if (kind === 'search' || kind === 'grep') {
    const parts: string[] = [];
    if (rawInput.pattern) parts.push(`"${rawInput.pattern}"`);
    if (rawInput.path) parts.push(`in ${rawInput.path}`);
    else if (rawInput.glob) parts.push(`in ${rawInput.glob}`);
    return parts.length > 0 ? parts.join(' ') : undefined;
  }
  if (kind === 'glob') {
    const parts: string[] = [];
    if (rawInput.pattern) parts.push(`${rawInput.pattern}`);
    if (rawInput.path) parts.push(`in ${rawInput.path}`);
    return parts.length > 0 ? parts.join(' ') : undefined;
  }

  for (const key of ['file_path', 'command', 'path', 'pattern', 'query', 'url', 'TargetFile']) {
    if (rawInput[key] && typeof rawInput[key] === 'string') return rawInput[key] as string;
  }
  return undefined;
};

type AcpToolCallUpdateCompat = IMessageAcpToolCall['content']['update'] & {
  session_update?: string;
  raw_input?: Record<string, unknown>;
};

type AcpToolCallContentCompat = IMessageAcpToolCall['content'] & {
  _compact?: {
    truncated?: boolean;
    original_size?: number;
    preview_chars?: number;
  };
  update?: AcpToolCallUpdateCompat;
};

export function normalizeAcpToolCall(message: IMessageAcpToolCall): NormalizedToolCall | undefined {
  const content = message.content as AcpToolCallContentCompat | undefined;
  const update = content?.update;
  if (!update) return undefined;

  const isTruncated = content?._compact?.truncated === true;
  const rawInput = update.rawInput ?? update.raw_input;
  const input = rawInput ? formatValue(rawInput) : undefined;

  let output: string | undefined;
  const diffItems: NormalizedFileChange[] = [];

  if (Array.isArray(update.content) && update.content.length) {
    output = update.content
      .map((item) => {
        if (typeof item !== 'object' || item === null) return '';
        if (item.type === 'content' && item.content?.text) return item.content.text;
        if (item.type === 'diff' && 'path' in item && typeof item.path === 'string' && item.path.trim()) {
          const fullPath = item.path.trim();
          if (!isTruncated && (typeof item.old_text === 'string' || typeof item.new_text === 'string')) {
            const oldText = item.old_text ?? '';
            const newText = item.new_text ?? '';
            const stats = buildPatchAndStats(fullPath, oldText, newText);
            diffItems.push({
              fileName: getBaseName(fullPath),
              fullPath,
              action: oldText.length === 0 && newText.length > 0 ? 'created' : 'edited',
              insertions: stats.insertions,
              deletions: stats.deletions,
              diff: stats.diff,
            });
          } else {
            diffItems.push({
              fileName: getBaseName(fullPath),
              fullPath,
              action: 'edited',
              insertions: 0,
              deletions: 0,
            });
          }
          return `[diff] ${item.path}`;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  const keyParam = buildParamSummary(update.kind, rawInput);
  const locations = Array.isArray(update.locations) ? update.locations : undefined;
  const fileChanges =
    diffItems.length > 0 ? diffItems : extractFileChangesFromInput(update.title || update.kind, rawInput, locations);

  const category = classifyCategory(update.title || '', update.kind, undefined, fileChanges.length > 0);
  const exploreAction = category === 'explore' ? classifyExploreAction(update.title || '', update.kind) : undefined;
  const filePath =
    fileChanges[0]?.fullPath ||
    (category === 'explore' && exploreAction === 'analyzed'
      ? firstString(rawInput, FILE_PATH_INPUT_KEYS) || locations?.find((loc) => typeof loc?.path === 'string')?.path
      : undefined);
  const lineRange = category === 'explore' && exploreAction === 'analyzed' ? extractLineRange(rawInput) : undefined;

  return {
    key: update.tool_call_id,
    name: update.title,
    status: normalizeAcpStatus(update.status),
    description: keyParam || (rawInput?.command as string) || update.kind,
    input,
    output,
    truncated: isTruncated,
    messageId: message.id,
    conversationId: message.conversation_id,
    imagePath: getAcpImagePath(update),
    category,
    exploreAction,
    filePath,
    lineRange,
    fileChanges: fileChanges.length > 0 ? fileChanges : undefined,
  };
}

// ===== tool_call → NormalizedToolCall =====

function normalizeToolCallStatus(status?: string): NormalizedToolStatus {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'error':
      return 'error';
    case 'running':
      return 'running';
    case 'canceled':
      return 'canceled';
    default:
      return 'pending';
  }
}

export function normalizeToolCall(message: IMessageToolCall): NormalizedToolCall | undefined {
  const { call_id, name, status, input, output, args, description } = message.content;
  if (!call_id) return undefined;

  const rawParams = isRecord(input) && Object.keys(input).length > 0 ? input : isRecord(args) ? args : undefined;
  const displayInput = input
    ? formatValue(input)
    : args && Object.keys(args).length > 0
      ? formatValue(args)
      : undefined;

  let fileChanges = extractFileChangesFromInput(name, rawParams);
  if (fileChanges.length === 0 && typeof output === 'string' && isUnifiedDiff(output) && looksLikeEditTool(name)) {
    const fullPath = firstString(rawParams, FILE_PATH_INPUT_KEYS) || description || 'unknown';
    const stats = countDiffStats(output);
    fileChanges = [
      {
        fileName: getBaseName(fullPath),
        fullPath,
        action: isCreatedDiff(output, name, stats.deletions) ? 'created' : 'edited',
        insertions: stats.insertions,
        deletions: stats.deletions,
        diff: output,
      },
    ];
  }

  const category = classifyCategory(name, undefined, undefined, fileChanges.length > 0);
  const exploreAction = category === 'explore' ? classifyExploreAction(name) : undefined;
  const filePath =
    fileChanges[0]?.fullPath ||
    (category === 'explore' && exploreAction === 'analyzed' ? firstString(rawParams, FILE_PATH_INPUT_KEYS) : undefined);
  const lineRange = category === 'explore' && exploreAction === 'analyzed' ? extractLineRange(rawParams) : undefined;

  const resolvedDescription =
    description ||
    (category === 'command' ? firstString(rawParams, ['command', 'cmd']) : undefined) ||
    filePath ||
    undefined;

  return {
    key: call_id,
    name,
    status: normalizeToolCallStatus(status),
    description: resolvedDescription,
    input: displayInput,
    output,
    category,
    exploreAction,
    filePath,
    lineRange,
    fileChanges: fileChanges.length > 0 ? fileChanges : undefined,
  };
}

// ===== Unified entry =====

export type ToolMessage = IMessageToolGroup | IMessageAcpToolCall | IMessageToolCall;

export function normalizeToolMessages(messages: ToolMessage[]): NormalizedToolCall[] {
  return messages
    .flatMap((m) => {
      if (m.type === 'tool_group') return normalizeToolGroup(m);
      if (m.type === 'acp_tool_call') return normalizeAcpToolCall(m);
      if (m.type === 'tool_call') return normalizeToolCall(m);
      return undefined;
    })
    .filter((item): item is NormalizedToolCall => item !== undefined);
}

export function hasRunningToolMessages(messages: ToolMessage[]): boolean {
  return messages.some((m) => {
    if (m.type === 'tool_group') {
      return Array.isArray(m.content) && m.content.some((t) => normalizeToolGroupStatus(t.status) === 'running');
    }
    if (m.type === 'acp_tool_call') {
      return m.content?.update && normalizeAcpStatus(m.content.update.status) === 'running';
    }
    if (m.type === 'tool_call') {
      return normalizeToolCallStatus(m.content?.status) === 'running';
    }
    return false;
  });
}
