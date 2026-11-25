/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BadgeProps } from '@arco-design/web-react';
import { Badge, Button, Message, Spin, Tooltip } from '@arco-design/web-react';
import { Down, Download, Right } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { getAcpImageFileName } from '@/common/chat/acpToolCallOutput';
import type {
  NormalizedFileChange,
  NormalizedToolCall,
  NormalizedToolStatus,
  ToolMessage,
} from '@/common/chat/normalizeToolCall';
import { hasRunningToolMessages, normalizeToolMessages } from '@/common/chat/normalizeToolCall';
import LocalImageView from '@/renderer/components/media/LocalImageView';
import { usePreviewLauncher } from '@/renderer/hooks/file/usePreviewLauncher';
import FileTypeIcon from '@/renderer/pages/conversation/explorer/fileIcon/FileTypeIcon';
import { isAbsoluteMessageFilePath } from '@/renderer/pages/conversation/Messages/components/fileMarker';
import { diffColors } from '@/renderer/styles/colors';
import { extractContentFromDiff } from '@/renderer/utils/file/diffUtils';
import { downloadFileFromPath } from '@/renderer/utils/file/download';
import { getFileTypeInfo } from '@/renderer/utils/file/fileType';
import './MessageToolGroupSummary.css';

const statusToBadge = (status: NormalizedToolStatus): BadgeProps['status'] => {
  switch (status) {
    case 'completed':
      return 'success';
    case 'error':
      return 'error';
    case 'running':
      return 'processing';
    case 'canceled':
    case 'pending':
    default:
      return 'default';
  }
};

const getBaseName = (filePath: string): string => filePath.split(/[/\\]/).pop() || filePath;

const formatWorkedDuration = (ms: number, t: (key: string, options?: Record<string, unknown>) => string): string => {
  const sUnit = t('common.unit.second_short', { defaultValue: 's' });
  const mUnit = t('common.unit.minute_short', { defaultValue: 'm' });
  if (ms < 1000) return `<1${sUnit}`;
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}${sUnit}`;
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  if (remainingSeconds === 0 || minutes >= 10) return `${minutes}${mUnit}`;
  return `${minutes}${mUnit} ${remainingSeconds}${sUnit}`;
};

const capitalizeFirst = (text: string): string => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

const buildActivitySummary = (
  tools: NormalizedToolCall[],
  t: (key: string, options?: Record<string, unknown>) => string
): string => {
  const hasExplore = tools.some((item) => item.category === 'explore');
  const hasCommand = tools.some((item) => item.category === 'command');
  const editTools = tools.filter((item) => item.category === 'edit' || (item.fileChanges?.length ?? 0) > 0);
  const hasEdit = editTools.length > 0;

  const parts: string[] = [];
  if (hasExplore) {
    parts.push(t('messages.activity.exploredFiles', { defaultValue: 'explored files' }));
  }
  if (hasCommand) {
    parts.push(t('messages.activity.ranCommands', { defaultValue: 'ran commands' }));
  }
  if (hasEdit) {
    const allChanges = editTools.flatMap((item) => item.fileChanges ?? []);
    const allCreated = allChanges.length > 0 && allChanges.every((fc) => fc.action === 'created');
    parts.push(
      allCreated
        ? t('messages.activity.createdFiles', { defaultValue: 'created files' })
        : t('messages.activity.editedFiles', { defaultValue: 'edited files' })
    );
  }
  if (parts.length === 0) {
    parts.push(t('messages.activity.usedTools', { defaultValue: 'used tools' }));
  }

  return capitalizeFirst(parts.join(', '));
};

const handleButtonKeyDown = (onActivate: () => void) => (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    onActivate();
  }
};

const ToolItemDetail: React.FC<{ item: NormalizedToolCall }> = ({ item }) => {
  const { t } = useTranslation();
  const { launchPreview } = usePreviewLauncher();
  const [expanded, setExpanded] = useState(false);
  const [fullItem, setFullItem] = useState<NormalizedToolCall | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const displayItem = fullItem ?? item;
  const hasDetail = Boolean(displayItem.input || displayItem.output || item.truncated || item.imagePath);
  const [messageApi, messageContext] = Message.useMessage();

  const handleDownloadImage = useCallback(
    async (path: string) => {
      try {
        await downloadFileFromPath(path, getAcpImageFileName(path));
        messageApi.success(t('acp.image.download_success'));
      } catch (error) {
        console.error('[MessageToolGroupSummary] Failed to download image:', error);
        messageApi.error(t('acp.image.download_error'));
      }
    },
    [messageApi, t]
  );

  const openFilePreview = useCallback(
    (fullPath: string, diff?: string) => {
      const fileName = getBaseName(fullPath);
      const { contentType, editable, language } = getFileTypeInfo(fileName);
      const isAbs = isAbsoluteMessageFilePath(fullPath);
      void launchPreview({
        ...(isAbs ? { originalPath: fullPath } : { relativePath: fullPath }),
        file_name: fileName,
        contentType,
        editable,
        language,
        fallbackContent: editable && diff ? extractContentFromDiff(diff) : undefined,
        diffContent: diff,
      });
    },
    [launchPreview]
  );

  const openDiffPreview = useCallback(
    (fullPath: string, diff: string) => {
      const fileName = getBaseName(fullPath);
      void launchPreview({
        file_name: fileName,
        title: fileName,
        contentType: 'diff',
        editable: false,
        language: 'diff',
        diffContent: diff,
      });
    },
    [launchPreview]
  );

  const loadFullItem = async () => {
    if (!item.truncated || fullItem || loadingFull || !item.conversationId || !item.messageId) return;
    setLoadingFull(true);
    setLoadError(false);
    try {
      const message = await ipcBridge.database.getConversationMessage.invoke({
        conversation_id: item.conversationId,
        message_id: item.messageId,
      });
      const next = normalizeToolMessages([message as ToolMessage]).find((candidate) => candidate.key === item.key);
      if (next) setFullItem(next);
    } catch {
      setLoadError(true);
    } finally {
      setLoadingFull(false);
    }
  };

  const toggleExpanded = () => {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded) void loadFullItem();
  };

  const renderStatusIndicator = () => {
    if (item.status === 'running') {
      return <Spin size={11} className='shrink-0' />;
    }
    if (item.status === 'error') {
      return <Badge status='error' className='shrink-0' />;
    }
    return null;
  };

  const renderExpandChevron = () => {
    if (!hasDetail) return null;
    return (
      <span
        className='activity-row__chevron'
        role='button'
        tabIndex={0}
        aria-expanded={expanded}
        onClick={(e) => {
          e.stopPropagation();
          toggleExpanded();
        }}
        onKeyDown={handleButtonKeyDown(toggleExpanded)}
      >
        {expanded ? <Down theme='outline' size={12} /> : <Right theme='outline' size={12} />}
      </span>
    );
  };

  const renderFileChangeActionLabel = (action: NormalizedFileChange['action']) => {
    if (action === 'created') return t('messages.activity.created', { defaultValue: 'Created' });
    if (action === 'modified') return t('messages.activity.modified', { defaultValue: 'Modified' });
    return t('messages.activity.edited', { defaultValue: 'Edited' });
  };

  const renderDetailSection = () =>
    expanded &&
    hasDetail && (
      <div className='tool-detail-panel m-l-20px m-t-4px'>
        {loadingFull && (
          <div className='tool-detail-label'>{t('messages.activity.loading', { defaultValue: 'Loading...' })}</div>
        )}
        {loadError && (
          <div className='tool-detail-label'>
            {t('messages.activity.loadError', { defaultValue: 'Failed to load full output' })}
          </div>
        )}
        {displayItem.input && (
          <div className='tool-detail-section'>
            <div className='tool-detail-label'>{t('messages.activity.input', { defaultValue: 'Input' })}</div>
            <pre className='tool-detail-content'>{displayItem.input}</pre>
          </div>
        )}
        {displayItem.output && (
          <div className='tool-detail-section'>
            <div className='tool-detail-label'>{t('messages.activity.output', { defaultValue: 'Output' })}</div>
            <pre className='tool-detail-content'>{displayItem.output}</pre>
          </div>
        )}
      </div>
    );

  const renderImageOutput = () =>
    item.imagePath && (
      <div className='group relative m-l-20px m-t-8px overflow-hidden rounded border bg-1 p-2 max-w-280px'>
        <LocalImageView
          src={item.imagePath}
          alt={getAcpImageFileName(item.imagePath)}
          className='max-w-full max-h-320px object-contain rounded'
        />
        <Tooltip content={t('acp.image.download')}>
          <Button
            aria-label={t('acp.image.download_aria')}
            className='!absolute end-10px top-10px !h-28px !w-28px !p-0 opacity-0 shadow-sm transition-opacity group-hover:opacity-90 focus:opacity-100'
            type='secondary'
            size='mini'
            shape='circle'
            icon={<Download theme='outline' size='14' />}
            onClick={() => void handleDownloadImage(item.imagePath!)}
          />
        </Tooltip>
      </div>
    );

  // 1. Edit / Create / Modify file rows
  if (displayItem.fileChanges && displayItem.fileChanges.length > 0) {
    return (
      <div className='flex flex-col'>
        {messageContext}
        {displayItem.fileChanges.map((fc, index) => (
          <div key={`${fc.fullPath}-${index}`} className='activity-row'>
            <span className='activity-row__verb'>{renderFileChangeActionLabel(fc.action)}</span>
            <FileTypeIcon node={{ name: fc.fileName, relativePath: fc.fullPath, isFile: true }} />
            <span
              className='activity-row__filename'
              title={fc.fullPath}
              role='button'
              tabIndex={0}
              onClick={() => openFilePreview(fc.fullPath, fc.diff)}
              onKeyDown={handleButtonKeyDown(() => openFilePreview(fc.fullPath, fc.diff))}
            >
              {fc.fileName}
            </span>
            {(fc.diff !== undefined || fc.insertions > 0 || fc.deletions > 0) && (
              <span
                className={classNames('activity-diff-stats', fc.diff && 'activity-diff-stats--clickable')}
                onClick={fc.diff ? () => openDiffPreview(fc.fullPath, fc.diff!) : undefined}
                data-testid='activity-diff-stats'
              >
                <span style={{ color: diffColors.addition }}>+{fc.insertions}</span>
                <span style={{ color: diffColors.deletion }}>-{fc.deletions}</span>
              </span>
            )}
            {index === 0 && renderStatusIndicator()}
            {index === 0 && renderExpandChevron()}
          </div>
        ))}
        {renderDetailSection()}
        {renderImageOutput()}
      </div>
    );
  }

  // 2. Command rows ("Ran <command> >")
  if (displayItem.category === 'command') {
    const commandLabel = displayItem.description || displayItem.name;
    return (
      <div className='flex flex-col'>
        {messageContext}
        <div
          className={classNames('activity-row', hasDetail && 'activity-row--interactive')}
          onClick={hasDetail ? toggleExpanded : undefined}
        >
          {renderStatusIndicator()}
          <span className='activity-row__verb'>{t('messages.activity.ran', { defaultValue: 'Ran' })}</span>
          <span className={classNames('activity-row__text', expanded ? 'break-all' : 'truncate')} title={commandLabel}>
            {commandLabel}
          </span>
          {renderExpandChevron()}
        </div>
        {renderDetailSection()}
        {renderImageOutput()}
      </div>
    );
  }

  // 3. Explore / Analyze / Search / List rows ("Analyzed <FileIcon> file.tsx #L1-579")
  if (displayItem.category === 'explore') {
    const verb =
      displayItem.exploreAction === 'searched'
        ? t('messages.activity.searched', { defaultValue: 'Searched' })
        : displayItem.exploreAction === 'listed'
          ? t('messages.activity.listed', { defaultValue: 'Listed' })
          : t('messages.activity.analyzed', { defaultValue: 'Analyzed' });
    const targetFilePath = displayItem.exploreAction === 'analyzed' ? displayItem.filePath : undefined;
    const baseName = targetFilePath ? getBaseName(targetFilePath) : undefined;

    return (
      <div className='flex flex-col'>
        {messageContext}
        <div
          className={classNames('activity-row', hasDetail && 'activity-row--interactive')}
          onClick={hasDetail ? toggleExpanded : undefined}
        >
          {renderStatusIndicator()}
          <span className='activity-row__verb'>{verb}</span>
          {displayItem.exploreAction === 'analyzed' && targetFilePath && baseName ? (
            <>
              <FileTypeIcon node={{ name: baseName, relativePath: targetFilePath, isFile: true }} />
              <span
                className='activity-row__filename'
                title={targetFilePath}
                role='button'
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  openFilePreview(targetFilePath);
                }}
                onKeyDown={handleButtonKeyDown(() => openFilePreview(targetFilePath))}
              >
                {baseName}
              </span>
              {displayItem.lineRange && <span className='activity-row__line-range'>{displayItem.lineRange}</span>}
            </>
          ) : (
            <span className={classNames('activity-row__text', expanded ? 'break-all' : 'truncate')}>
              {displayItem.description || displayItem.name}
            </span>
          )}
          {renderExpandChevron()}
        </div>
        {renderDetailSection()}
        {renderImageOutput()}
      </div>
    );
  }

  // 4. Generic tool rows
  return (
    <div className='flex flex-col'>
      {messageContext}
      <div className='activity-row'>
        <Badge status={statusToBadge(item.status)} className={item.status === 'running' ? 'badge-breathing' : ''} />
        <span
          className={classNames(
            'flex-1 min-w-0',
            expanded ? 'break-all' : 'truncate',
            hasDetail && 'cursor-pointer hover:text-t-primary'
          )}
          onClick={hasDetail ? toggleExpanded : undefined}
        >
          <span className='font-medium text-13px'>{displayItem.name}</span>
          {displayItem.description && displayItem.description !== displayItem.name && (
            <span className='m-l-4px opacity-80 text-13px'>{displayItem.description}</span>
          )}
        </span>
        {renderExpandChevron()}
      </div>
      {renderDetailSection()}
      {renderImageOutput()}
    </div>
  );
};

const MessageToolGroupSummary: React.FC<{ messages: ToolMessage[]; durationMs?: number }> = ({
  messages,
  durationMs,
}) => {
  const { t } = useTranslation();
  const hasRunning = hasRunningToolMessages(messages);
  const tools = useMemo(() => normalizeToolMessages(messages), [messages]);
  const hasFileChanges = useMemo(() => tools.some((item) => (item.fileChanges?.length ?? 0) > 0), [tools]);

  const [outerExpanded, setOuterExpanded] = useState(true);
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const showMore = userExpanded ?? (hasRunning || hasFileChanges);

  const [liveElapsedMs, setLiveElapsedMs] = useState(0);

  useEffect(() => {
    if (!hasRunning) {
      setLiveElapsedMs(0);
      return;
    }
    const validTimestamps = messages
      .map((m) => m.created_at)
      .filter((ts): ts is number => typeof ts === 'number' && ts > 0);
    const origin = validTimestamps.length > 0 ? Math.min(...validTimestamps) : Date.now();
    const update = () => setLiveElapsedMs(Math.max(0, Date.now() - origin));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [hasRunning, messages]);

  const showWorkedHeader = hasRunning || (typeof durationMs === 'number' && durationMs > 0);
  const workedLabel = hasRunning
    ? `${t('messages.activity.working', { defaultValue: 'Working...' })} · ${formatWorkedDuration(liveElapsedMs, t)}`
    : t('messages.activity.workedFor', {
        duration: formatWorkedDuration(durationMs ?? 0, t),
        defaultValue: `Worked for ${formatWorkedDuration(durationMs ?? 0, t)}`,
      });

  const activitySummaryLabel = useMemo(() => buildActivitySummary(tools, t), [tools, t]);

  const toggleOuter = () => setOuterExpanded((prev) => !prev);
  const toggleInner = () => setUserExpanded(!showMore);

  const renderInnerSection = () => (
    <div className={classNames('activity-inner', showWorkedHeader && 'activity-inner--nested')}>
      <div
        className='tool-group-summary__header'
        role='button'
        tabIndex={0}
        aria-expanded={showMore}
        onClick={toggleInner}
        onKeyDown={handleButtonKeyDown(toggleInner)}
      >
        <span className='tool-group-summary__label'>{activitySummaryLabel}</span>
        <span className={classNames('tool-group-summary__arrow', showMore && 'tool-group-summary__arrow--open')}>
          <Right theme='outline' size='12' />
        </span>
      </div>
      {showMore && (
        <div className='tool-group-summary__body'>
          {tools.map((item) => (
            <ToolItemDetail key={item.key} item={item} />
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className='tool-group-summary' data-testid='activity-summary'>
      {showWorkedHeader ? (
        <>
          <div
            className='tool-group-summary__worked-header'
            role='button'
            tabIndex={0}
            aria-expanded={outerExpanded}
            onClick={toggleOuter}
            onKeyDown={handleButtonKeyDown(toggleOuter)}
          >
            {hasRunning && <Spin size={12} />}
            <span className='tool-group-summary__label'>{workedLabel}</span>
            <span
              className={classNames('tool-group-summary__arrow', outerExpanded && 'tool-group-summary__arrow--open')}
            >
              <Right theme='outline' size='12' />
            </span>
          </div>
          {outerExpanded && renderInnerSection()}
        </>
      ) : (
        renderInnerSection()
      )}
    </div>
  );
};

export default React.memo(MessageToolGroupSummary);
