/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IMessageSearchItem } from '@/common/types/team/database';
import AionModal from '@/renderer/components/base/AionModal';
import { AionSearchInput } from '@/renderer/components/base';
import { formatDateTime } from '@/renderer/services/i18n/format';
import { usePresetAssistantInfo } from '@/renderer/hooks/agent/usePresetAssistantInfo';
import { useAgentLogos } from '@/renderer/utils/model/agentLogo';
import ThemedLogo from '@/renderer/components/agent/ThemedLogo';
import { resolveConversationLeadingMark } from '@/renderer/pages/conversation/utils/conversationAssistantIdentity';
import { blockMobileInputFocus, blurActiveElement } from '@/renderer/utils/ui/focus';
import { isPrimaryApplicationShortcut } from '@/renderer/utils/ui/keyboardShortcuts';
import { Empty, Spin, Tag, Typography } from '@arco-design/web-react';
import { Close, FolderClose, MessageOne, NetworkTree, Peoples, Robot, Search, SettingTwo } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { preloadRouteForPath } from '@/renderer/utils/navigation';
import './ConversationSearchPopover.css';

const PAGE_SIZE = 20;
const MAX_RECENT_SEARCHES = 8;
const RECENT_SEARCH_STORAGE_KEY = 'conversation.historySearch.recentKeywords';
const SNIPPET_MAX_LENGTH = 110;
const SNIPPET_PREFIX_CONTEXT_LENGTH = 34;
const SNIPPET_SUFFIX_CONTEXT_LENGTH = 58;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildSnippet = (text: string, keyword: string, maxLength = SNIPPET_MAX_LENGTH): string => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (!keyword.trim()) {
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trimEnd()}...` : normalized;
  }

  const lowerText = normalized.toLowerCase();
  const lowerKeyword = keyword.trim().toLowerCase();
  const matchIndex = lowerText.indexOf(lowerKeyword);
  if (matchIndex === -1) {
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trimEnd()}...` : normalized;
  }

  let start = Math.max(0, matchIndex - SNIPPET_PREFIX_CONTEXT_LENGTH);
  let end = Math.min(normalized.length, matchIndex + lowerKeyword.length + SNIPPET_SUFFIX_CONTEXT_LENGTH);

  if (end - start > maxLength) {
    const centeredStart = Math.max(0, matchIndex - Math.floor((maxLength - lowerKeyword.length) / 2));
    start = Math.min(centeredStart, Math.max(0, normalized.length - maxLength));
    end = Math.min(normalized.length, start + maxLength);
  }

  const snippet = normalized.slice(start, end).trim();
  return `${start > 0 ? '...' : ''}${snippet}${end < normalized.length ? '...' : ''}`;
};

const renderHighlightedText = (text: string, keyword: string) => {
  if (!keyword.trim()) {
    return text;
  }

  const pattern = new RegExp(`(${escapeRegExp(keyword.trim())})`, 'ig');
  const parts = text.split(pattern);
  const lowerKeyword = keyword.trim().toLowerCase();

  return parts.map((part, index) => {
    if (part.toLowerCase() !== lowerKeyword) {
      return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
    }

    return (
      <mark key={`${part}-${index}`} className='conversation-search-modal__highlight'>
        {part}
      </mark>
    );
  });
};

const formatTime = (timestamp: number, locale: string): string => {
  if (!timestamp) return '';
  return formatDateTime(timestamp, locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

interface ConversationSearchPopoverProps {
  onSessionClick?: () => void;
  onConversationSelect?: () => void;
  disabled?: boolean;
  buttonClassName?: string;
  label?: string;
  fullWidth?: boolean;
  renderTrigger?: (props: { onClick: () => void; isActive: boolean }) => React.ReactNode;
}

const ConversationAgentMark: React.FC<{ conversation: IMessageSearchItem['conversation'] }> = ({ conversation }) => {
  const logos = useAgentLogos();
  const { info: assistantInfo } = usePresetAssistantInfo(conversation);
  const leadingMark = resolveConversationLeadingMark(conversation, assistantInfo, logos);
  if (leadingMark.kind === 'emoji') {
    return (
      <span className='text-18px leading-none flex-shrink-0' title={leadingMark.label}>
        {leadingMark.value}
      </span>
    );
  }
  if (leadingMark.kind === 'image') {
    return (
      <ThemedLogo
        src={leadingMark.value}
        alt={leadingMark.label}
        title={leadingMark.label}
        className='w-18px h-18px rounded-50% flex-shrink-0'
      />
    );
  }
  if (leadingMark.kind === 'assistant_fallback') {
    return <Robot theme='outline' size='18' className='line-height-0 flex-shrink-0 text-t-secondary' />;
  }

  return <MessageOne theme='outline' size='18' className='line-height-0 flex-shrink-0 text-t-secondary' />;
};

type QuickJumpKind = 'view' | 'team' | 'project' | 'settings';

type QuickJumpTarget = {
  id: string;
  kind: QuickJumpKind;
  label: string;
  subtitle: string;
  path: string;
  keywords: string;
};

const STATIC_QUICK_JUMP_TARGETS: QuickJumpTarget[] = [
  {
    id: 'view:workplace',
    kind: 'view',
    label: 'Workplace',
    subtitle: 'Home & conversations',
    path: '/guid',
    keywords: 'workplace home guid chat conversations',
  },
  {
    id: 'view:organization',
    kind: 'view',
    label: 'Organization',
    subtitle: 'Org chart canvas & departments',
    path: '/organization',
    keywords: 'organization org chart canvas departments ceo',
  },
  {
    id: 'view:approvals',
    kind: 'view',
    label: 'Approvals',
    subtitle: 'Pending approvals inbox',
    path: '/approvals',
    keywords: 'approvals notifications inbox',
  },
  {
    id: 'view:assistants',
    kind: 'view',
    label: 'Assistants',
    subtitle: 'Preset assistants',
    path: '/assistants',
    keywords: 'assistants presets',
  },
  {
    id: 'view:scheduled',
    kind: 'view',
    label: 'Scheduled Tasks',
    subtitle: 'Cron jobs & automations',
    path: '/scheduled',
    keywords: 'scheduled cron tasks automations',
  },
  {
    id: 'view:today',
    kind: 'view',
    label: 'Today',
    subtitle: 'Daily overview',
    path: '/today',
    keywords: 'today daily overview',
  },
  {
    id: 'view:costs',
    kind: 'view',
    label: 'Costs',
    subtitle: 'Token & spend analytics',
    path: '/costs',
    keywords: 'costs spend usage billing',
  },
  {
    id: 'settings:agent',
    kind: 'settings',
    label: 'Settings: Agents',
    subtitle: 'Configure agents & runtimes',
    path: '/settings/agent',
    keywords: 'settings agents preferences',
  },
  {
    id: 'settings:model',
    kind: 'settings',
    label: 'Settings: Model',
    subtitle: 'Default models & providers',
    path: '/settings/model',
    keywords: 'settings model llm provider',
  },
  {
    id: 'settings:gateway',
    kind: 'settings',
    label: 'Settings: Model Provider Hub',
    subtitle: 'API keys & gateways',
    path: '/settings/gateway',
    keywords: 'settings gateway model provider hub api keys',
  },
  {
    id: 'settings:skills',
    kind: 'settings',
    label: 'Settings: Skills',
    subtitle: 'Manage skills hub',
    path: '/settings/skills',
    keywords: 'settings skills hub',
  },
  {
    id: 'settings:tools',
    kind: 'settings',
    label: 'Settings: Tools',
    subtitle: 'MCP & tool integrations',
    path: '/settings/tools',
    keywords: 'settings tools mcp',
  },
  {
    id: 'settings:rules',
    kind: 'settings',
    label: 'Settings: Rules',
    subtitle: 'Remembered rules',
    path: '/settings/rules',
    keywords: 'settings rules memory',
  },
  {
    id: 'settings:appearance',
    kind: 'settings',
    label: 'Settings: Appearance',
    subtitle: 'Theme, font & layout',
    path: '/settings/appearance',
    keywords: 'settings appearance theme dark light',
  },
  {
    id: 'settings:webui',
    kind: 'settings',
    label: 'Settings: WebUI',
    subtitle: 'Web server & remote access',
    path: '/settings/webui',
    keywords: 'settings webui server',
  },
  {
    id: 'settings:system',
    kind: 'settings',
    label: 'Settings: System',
    subtitle: 'System & runtime diagnostics',
    path: '/settings/system',
    keywords: 'settings system diagnostics',
  },
  {
    id: 'settings:archived',
    kind: 'settings',
    label: 'Settings: Archived',
    subtitle: 'Restore archived chats & teams',
    path: '/settings/archived',
    keywords: 'settings archived restore',
  },
  {
    id: 'settings:about',
    kind: 'settings',
    label: 'Settings: About',
    subtitle: 'Version & updates',
    path: '/settings/about',
    keywords: 'settings about version update',
  },
];

const renderQuickJumpIcon = (kind: QuickJumpKind, path: string) => {
  if (kind === 'team') {
    return <Peoples theme='outline' size='16' className='shrink-0 text-t-secondary' />;
  }
  if (kind === 'project') {
    return <FolderClose theme='outline' size='16' className='shrink-0 text-t-secondary' />;
  }
  if (kind === 'settings') {
    return <SettingTwo theme='outline' size='16' className='shrink-0 text-t-secondary' />;
  }
  if (path.startsWith('/organization')) {
    return <NetworkTree theme='outline' size='16' className='shrink-0 text-t-secondary' />;
  }
  return <MessageOne theme='outline' size='16' className='shrink-0 text-t-secondary' />;
};

const ConversationSearchPopover: React.FC<ConversationSearchPopoverProps> = ({
  onSessionClick,
  onConversationSelect,
  disabled = false,
  buttonClassName,
  label,
  fullWidth = false,
  renderTrigger,
}) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [items, setItems] = useState<IMessageSearchItem[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [recentKeywords, setRecentKeywords] = useState<string[]>([]);
  const [platformFilter, setPlatformFilter] = useState<'all' | 'aionrs' | 'acp' | 'codex'>('all');
  const [dateFilter, setDateFilter] = useState<'all' | '1d' | '7d' | '30d'>('all');
  const [dynamicTargets, setDynamicTargets] = useState<QuickJumpTarget[]>([]);
  const [activeQuickIndex, setActiveQuickIndex] = useState(0);

  const handleOpen = useCallback(() => {
    if (!disabled) {
      setVisible(true);
    }
  }, [disabled]);

  useEffect(() => {
    const handleOpenEvent = () => {
      handleOpen();
    };
    window.addEventListener('open-history-search', handleOpenEvent);
    return () => {
      window.removeEventListener('open-history-search', handleOpenEvent);
    };
  }, [handleOpen]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_SEARCH_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const sanitized = parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
        setRecentKeywords(sanitized.slice(0, MAX_RECENT_SEARCHES));
      }
    } catch {
      // Ignore storage parse errors and fallback to empty history.
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedKeyword(keyword.trim());
    }, 250);

    return () => window.clearTimeout(timer);
  }, [keyword]);

  const runSearch = useCallback(
    async (pageToLoad: number, append: boolean) => {
      if (!debouncedKeyword) {
        setItems([]);
        setPage(0);
        setHasMore(false);
        return;
      }

      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      try {
        const result = await ipcBridge.database.searchConversationMessages.invoke({
          keyword: debouncedKeyword,
          page: pageToLoad,
          page_size: PAGE_SIZE,
        });

        setItems((prev) => (append ? [...prev, ...result.items] : result.items));
        setPage(pageToLoad);
        setHasMore(result.has_more);
      } catch (error) {
        console.error('[ConversationSearchPopover] Search failed:', error);
        if (!append) {
          setItems([]);
          setPage(0);
          setHasMore(false);
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [debouncedKeyword]
  );

  useEffect(() => {
    void runSearch(0, false);
  }, [runSearch]);

  useEffect(() => {
    if (!debouncedKeyword) return;
    const normalized = debouncedKeyword.trim();
    if (!normalized) return;

    setRecentKeywords((prev) => {
      const nextKeywords = [normalized, ...prev.filter((item) => item !== normalized)].slice(0, MAX_RECENT_SEARCHES);
      const unchanged =
        nextKeywords.length === prev.length && nextKeywords.every((item, index) => item === prev[index]);
      if (unchanged) {
        return prev;
      }

      try {
        localStorage.setItem(RECENT_SEARCH_STORAGE_KEY, JSON.stringify(nextKeywords));
      } catch {
        // Ignore storage write errors in private mode / restricted environments.
      }

      return nextKeywords;
    });
  }, [debouncedKeyword]);

  const resetSearchState = useCallback(() => {
    setVisible(false);
    setKeyword('');
    setDebouncedKeyword('');
    setItems([]);
    setPage(0);
    setHasMore(false);
    setLoading(false);
    setLoadingMore(false);
  }, []);

  const handleLoadMore = useCallback(() => {
    if (!visible || !debouncedKeyword || loading || loadingMore || !hasMore) {
      return;
    }

    void runSearch(page + 1, true);
  }, [debouncedKeyword, hasMore, loading, loadingMore, page, runSearch, visible]);

  const handleResultClick = useCallback(
    async (item: IMessageSearchItem) => {
      blockMobileInputFocus();
      blurActiveElement();

      flushSync(() => {
        resetSearchState();
      });

      onConversationSelect?.();

      await Promise.resolve(
        navigate(`/conversation/${item.conversation.id}`, {
          state: {
            targetMessageId: item.message_id,
            fromConversationSearch: true,
          },
        })
      );
      onSessionClick?.();
    },
    [navigate, onConversationSelect, onSessionClick, resetSearchState]
  );

  const handleClose = useCallback(() => {
    resetSearchState();
  }, [resetSearchState]);

  const handleClearKeyword = useCallback(() => {
    setKeyword('');
    setDebouncedKeyword('');
    setItems([]);
    setPage(0);
    setHasMore(false);
    setLoading(false);
    setLoadingMore(false);
  }, []);

  useEffect(() => {
    const handleGlobalSearchShortcut = (event: KeyboardEvent) => {
      if (
        !isPrimaryApplicationShortcut(event, {
          key: 'f',
          shiftKey: true,
          targetGuard: 'embedded-editor',
        }) &&
        !isPrimaryApplicationShortcut(event, {
          key: 'k',
          targetGuard: 'embedded-editor',
        })
      ) {
        return;
      }
      // Preserve browser behavior in WebUI; only intercept in the desktop runtime.
      if (typeof window !== 'undefined' && !window.electronAPI) return;
      if (disabled) return;
      event.preventDefault();
      handleOpen();
    };

    document.addEventListener('keydown', handleGlobalSearchShortcut, true);
    return () => {
      document.removeEventListener('keydown', handleGlobalSearchShortcut, true);
    };
  }, [disabled, handleOpen]);

  const triggerAriaLabel = t('conversation.historySearch.tooltip');

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    const loadQuickTargets = async () => {
      const collected: QuickJumpTarget[] = [];

      try {
        const teams = await ipcBridge.team?.list?.invoke?.({ user_id: 'system_default_user' });
        if (Array.isArray(teams)) {
          for (const team of teams) {
            if (team?.id && team?.name) {
              collected.push({
                id: `team:${team.id}`,
                kind: 'team',
                label: team.name,
                subtitle: 'Team',
                path: `/team/${team.id}`,
                keywords: `team ${team.name}`,
              });
            }
          }
        }
      } catch {
        // Ignore when team IPC is unavailable in isolated tests
      }

      try {
        const convResult = await ipcBridge.database?.getUserConversations?.invoke?.({ limit: 100 });
        const list = convResult?.items;
        if (Array.isArray(list)) {
          const seenWorkspaces = new Set<string>();
          for (const conv of list) {
            const workspace = (conv?.extra as { workspace?: string } | undefined)?.workspace;
            if (!workspace || seenWorkspaces.has(workspace)) continue;
            seenWorkspaces.add(workspace);
            const folderName = workspace.split(/[\\/]/).filter(Boolean).pop() || workspace;
            collected.push({
              id: `project:${workspace}`,
              kind: 'project',
              label: folderName,
              subtitle: workspace,
              path: `/conversation/${conv.id}`,
              keywords: `project workspace ${folderName} ${workspace}`,
            });
          }
        }
      } catch {
        // Ignore when conversation list IPC is unavailable
      }

      if (!cancelled) {
        setDynamicTargets(collected);
      }
    };

    void loadQuickTargets();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const quickJumpResults = useMemo(() => {
    const allTargets = [...dynamicTargets, ...STATIC_QUICK_JUMP_TARGETS];
    const query = keyword.trim().toLowerCase();
    if (!query) {
      // Show top destinations immediately when opened
      const priorityIds = new Set([
        'view:workplace',
        'view:organization',
        'settings:agent',
        'settings:model',
        'view:approvals',
        'view:scheduled',
      ]);
      const teamsAndProjects = dynamicTargets.slice(0, 4);
      const priorityViews = STATIC_QUICK_JUMP_TARGETS.filter((item) => priorityIds.has(item.id));
      return [...teamsAndProjects, ...priorityViews];
    }

    return allTargets
      .filter(
        (item) =>
          item.label.toLowerCase().includes(query) ||
          item.subtitle.toLowerCase().includes(query) ||
          item.keywords.toLowerCase().includes(query)
      )
      .slice(0, 8);
  }, [dynamicTargets, keyword]);

  useEffect(() => {
    setActiveQuickIndex(0);
  }, [keyword, visible]);

  const handleQuickJumpClick = useCallback(
    (target: QuickJumpTarget) => {
      blockMobileInputFocus();
      blurActiveElement();
      preloadRouteForPath(target.path);
      flushSync(() => {
        resetSearchState();
      });
      void navigate(target.path);
      onSessionClick?.();
    },
    [navigate, onSessionClick, resetSearchState]
  );

  useEffect(() => {
    if (!visible || quickJumpResults.length === 0) return;
    const handleKeyNav = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveQuickIndex((prev) => (prev + 1) % quickJumpResults.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveQuickIndex((prev) => (prev - 1 + quickJumpResults.length) % quickJumpResults.length);
      } else if (event.key === 'Enter') {
        const selected = quickJumpResults[activeQuickIndex];
        if (selected && keyword.trim().length > 0) {
          event.preventDefault();
          handleQuickJumpClick(selected);
        }
      }
    };
    window.addEventListener('keydown', handleKeyNav);
    return () => window.removeEventListener('keydown', handleKeyNav);
  }, [activeQuickIndex, handleQuickJumpClick, keyword, quickJumpResults, visible]);

  const displayedItems = useMemo(() => {
    return items.filter((item) => {
      if (platformFilter !== 'all') {
        const pType = (item.conversation.type || '').toLowerCase();
        if (!pType.includes(platformFilter)) {
          return false;
        }
      }
      if (dateFilter !== 'all') {
        const now = Date.now();
        const msgTime = item.message_created_at;
        const diff = now - msgTime;
        if (dateFilter === '1d' && diff > 86400000) return false;
        if (dateFilter === '7d' && diff > 604800000) return false;
        if (dateFilter === '30d' && diff > 2592000000) return false;
      }
      return true;
    });
  }, [items, platformFilter, dateFilter]);

  const resultContent = useMemo(() => {
    const quickJumpSection =
      quickJumpResults.length > 0 ? (
        <div className='mb-12px'>
          <div className='text-11px font-semibold uppercase tracking-wider text-t-tertiary px-6px mb-6px'>
            {t('conversation.historySearch.quickJump', { defaultValue: 'Quick Jump' })}
          </div>
          <div className='grid grid-cols-2 gap-6px'>
            {quickJumpResults.map((target, index) => (
              <button
                key={target.id}
                type='button'
                onMouseEnter={() => {
                  setActiveQuickIndex(index);
                  preloadRouteForPath(target.path);
                }}
                onClick={() => handleQuickJumpClick(target)}
                className={classNames(
                  'flex items-center gap-8px px-10px py-8px rounded-8px text-start cursor-pointer transition-colors border border-solid',
                  index === activeQuickIndex
                    ? 'bg-fill-3 border-[rgba(var(--primary-6),0.35)]'
                    : 'bg-fill-1/60 border-[var(--color-border-2)] hover:bg-fill-2'
                )}
              >
                {renderQuickJumpIcon(target.kind, target.path)}
                <div className='min-w-0 flex-1'>
                  <div className='text-13px font-medium text-t-primary truncate'>{target.label}</div>
                  <div className='text-11px text-t-tertiary truncate'>{target.subtitle}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null;

    if (!debouncedKeyword) {
      return (
        <div className='flex flex-col gap-8px'>
          {quickJumpSection}
          <div className='conversation-search-modal__state'>
            <div className='conversation-search-modal__state-content'>
              <span className='text-13px'>{t('conversation.historySearch.idle')}</span>
              {recentKeywords.length > 0 ? (
                <div className='conversation-search-modal__recent-wrap'>
                  {recentKeywords.map((item) => (
                    <button
                      key={item}
                      type='button'
                      className='conversation-search-modal__recent-chip'
                      onClick={() => setKeyword(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      );
    }

    if (loading && items.length === 0) {
      return (
        <div className='flex flex-col gap-8px'>
          {quickJumpSection}
          <div className='h-120px flex items-center justify-center'>
            <Spin size={20} />
          </div>
        </div>
      );
    }

    if (displayedItems.length === 0) {
      return (
        <div className='flex flex-col gap-8px'>
          {quickJumpSection}
          <div className='conversation-search-modal__state'>
            <Empty className='py-2px' description={t('conversation.historySearch.empty')} />
          </div>
        </div>
      );
    }

    return (
      <div
        className='h-full min-h-0 overflow-y-auto overflow-x-hidden pe-4px'
        onScroll={(event) => {
          const target = event.currentTarget;
          if (target.scrollHeight - target.scrollTop - target.clientHeight < 48) {
            handleLoadMore();
          }
        }}
      >
        {quickJumpSection}
        <div className='conversation-search-modal__results flex flex-col'>
          {displayedItems.map((item) => {
            const snippet = buildSnippet(item.preview_text, debouncedKeyword);
            return (
              <button
                key={`${item.message_id}-${item.message_created_at}`}
                type='button'
                className={classNames(
                  'conversation-search-modal__result w-full text-start cursor-pointer transition-all duration-150',
                  'focus:outline-none'
                )}
                onClick={() => {
                  void handleResultClick(item);
                }}
              >
                <div className='flex items-start justify-between gap-8px mb-6px'>
                  <div className='min-w-0 flex-1'>
                    <div className='conversation-search-modal__result-title-row'>
                      <ConversationAgentMark conversation={item.conversation} />
                      <div className='conversation-search-modal__result-title text-15px font-600 text-t-primary truncate'>
                        {item.conversation.name || t('conversation.historySearch.untitled')}
                      </div>
                    </div>
                  </div>
                  <span className='shrink-0 text-11px text-t-secondary'>
                    {formatTime(item.message_created_at, i18n?.language ?? 'en-US')}
                  </span>
                </div>
                <div className='conversation-search-modal__snippet text-13px leading-22px text-t-primary/92 break-words'>
                  {renderHighlightedText(snippet, debouncedKeyword)}
                </div>
              </button>
            );
          })}

          {loadingMore && (
            <div className='py-8px flex items-center justify-center gap-8px text-12px text-t-secondary'>
              <Spin size={14} />
              <span>{t('conversation.historySearch.loadingMore')}</span>
            </div>
          )}
        </div>
      </div>
    );
  }, [
    activeQuickIndex,
    dateFilter,
    debouncedKeyword,
    displayedItems,
    handleLoadMore,
    handleQuickJumpClick,
    handleResultClick,
    i18n?.language,
    items.length,
    loading,
    loadingMore,
    platformFilter,
    quickJumpResults,
    recentKeywords,
    t,
  ]);

  const hasSearchResults = items.length > 0;
  const useCompactHeight = !debouncedKeyword || (!loading && !hasSearchResults);
  const triggerClassName = fullWidth
    ? 'conversation-search-trigger-full h-34px w-full p-0 bg-transparent border-none outline-none flex items-center justify-start gap-8px ps-10px pe-8px rd-0.5rem cursor-pointer shrink-0 transition-all group text-t-primary focus:outline-none focus-visible:outline-none'
    : 'h-34px w-34px p-0 bg-transparent rd-0.5rem flex items-center justify-center cursor-pointer shrink-0 transition-all border border-solid border-transparent text-t-secondary hover:text-t-primary';

  return (
    <>
      {renderTrigger ? (
        renderTrigger({ onClick: handleOpen, isActive: visible })
      ) : (
        <button
          type='button'
          aria-label={triggerAriaLabel}
          className={classNames(
            triggerClassName,
            {
              'hover:bg-fill-3 active:bg-fill-4': !disabled && fullWidth,
              'hover:bg-fill-2 hover:border-[color:var(--color-border-2)]': !disabled && !fullWidth,
              'opacity-50 cursor-not-allowed': disabled,
              'bg-aou-2 text-primary border-[color:var(--color-primary-light-3)]': visible && !disabled && !fullWidth,
            },
            buttonClassName
          )}
          onClick={handleOpen}
          disabled={disabled}
        >
          {fullWidth ? (
            <span className='size-22px flex items-center justify-center shrink-0 text-t-primary'>
              <Search
                theme='outline'
                size='16'
                fill='currentColor'
                className='block leading-none'
                style={{ lineHeight: 0 }}
              />
            </span>
          ) : (
            <Search
              theme='outline'
              size='16'
              fill='currentColor'
              className='block leading-none shrink-0'
              style={{ lineHeight: 0 }}
            />
          )}
          {fullWidth && label ? (
            <span className='collapsed-hidden text-t-primary text-14px font-[500] leading-24px'>{label}</span>
          ) : null}
        </button>
      )}

      <AionModal
        visible={visible}
        onCancel={handleClose}
        footer={null}
        showCustomClose={false}
        unmountOnExit
        className='conversation-search-modal'
        maskStyle={{
          background: 'var(--conversation-search-mask-bg)',
          backdropFilter: 'blur(1px)',
          WebkitBackdropFilter: 'blur(1px)',
        }}
        style={{
          width: 'min(700px, calc(100vw - 56px))',
          borderRadius: '24px',
          background: 'transparent',
          boxShadow: 'none',
        }}
        contentStyle={{
          background: 'transparent',
          borderRadius: '24px',
          padding: '0',
          overflow: 'hidden',
          height: useCompactHeight ? 'auto' : 'min(70vh, 720px)',
          minHeight: useCompactHeight ? '300px' : undefined,
          maxHeight: 'min(70vh, 720px)',
        }}
      >
        <div
          className={classNames('conversation-search-modal__panel flex flex-col', {
            'h-full min-h-0': !useCompactHeight,
          })}
        >
          <div className='conversation-search-modal__header'>
            <div className='conversation-search-modal__header-main'>
              <div className='conversation-search-modal__title'>{t('conversation.historySearch.title')}</div>
              <Typography.Paragraph className='conversation-search-modal__description !mb-0 text-13px text-t-secondary'>
                {t('conversation.historySearch.description')}
              </Typography.Paragraph>
            </div>
            <button
              type='button'
              className='conversation-search-modal__close-btn'
              onClick={handleClose}
              aria-label='Close'
            >
              <Close size={16} />
            </button>
          </div>

          <div className='mb-14px conversation-search-modal__input-wrap'>
            <AionSearchInput
              className='w-full'
              autoFocus={visible}
              value={keyword}
              placeholder={t('conversation.historySearch.placeholder')}
              onChange={setKeyword}
              onClear={handleClearKeyword}
            />
          </div>

          <div className='flex items-center gap-12px mb-12px flex-wrap text-12px'>
            <div className='flex items-center gap-6px'>
              <span className='text-t-secondary'>Platform:</span>
              {(['all', 'aionrs', 'acp', 'codex'] as const).map((p) => (
                <Tag
                  key={p}
                  size='small'
                  color={platformFilter === p ? 'arcoblue' : undefined}
                  className='cursor-pointer uppercase'
                  onClick={() => setPlatformFilter(p)}
                >
                  {p}
                </Tag>
              ))}
            </div>
            <div className='flex items-center gap-6px'>
              <span className='text-t-secondary'>Date:</span>
              {(
                [
                  { label: 'All', value: 'all' },
                  { label: '24h', value: '1d' },
                  { label: '7d', value: '7d' },
                  { label: '30d', value: '30d' },
                ] as const
              ).map((d) => (
                <Tag
                  key={d.value}
                  size='small'
                  color={dateFilter === d.value ? 'arcoblue' : undefined}
                  className='cursor-pointer'
                  onClick={() => setDateFilter(d.value)}
                >
                  {d.label}
                </Tag>
              ))}
            </div>
          </div>

          <div className='flex-1 min-h-0'>{resultContent}</div>
        </div>
      </AionModal>
    </>
  );
};

export default ConversationSearchPopover;
