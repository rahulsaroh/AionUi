import { useEffect } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import { useVisibleConversationIds } from '@/renderer/pages/conversation/GroupedHistory/hooks/useVisibleConversationIds';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { isPlatformPrimaryModifier, isPrimaryApplicationShortcut } from '@/renderer/utils/ui/keyboardShortcuts';
import { dispatchWorkspaceToggleEvent } from '@/renderer/utils/workspace/workspaceEvents';

type UseConversationShortcutsParams = {
  navigate: NavigateFunction;
  toggleSider: () => void;
  toggleTheme?: () => void;
};

const getCycledConversationId = (
  visibleConversationIds: string[],
  activeConversationId: string | null,
  direction: 1 | -1
): string | null => {
  if (visibleConversationIds.length < 2 || !activeConversationId) {
    return null;
  }

  const activeIndex = visibleConversationIds.findIndex((conversation_id) => conversation_id === activeConversationId);
  if (activeIndex === -1) {
    return null;
  }

  const nextIndex = (activeIndex + direction + visibleConversationIds.length) % visibleConversationIds.length;
  return visibleConversationIds[nextIndex] ?? null;
};

const isConversationTabShortcut = (event: KeyboardEvent): boolean => {
  return event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Tab';
};

const isNewConversationShortcut = (event: KeyboardEvent): boolean => {
  const key = event.key.toLowerCase();
  return isPlatformPrimaryModifier(event) && !event.altKey && !event.shiftKey && (key === 't' || key === 'n');
};

export const useConversationShortcuts = ({
  navigate,
  toggleSider,
  toggleTheme,
}: UseConversationShortcutsParams): void => {
  const location = useLocation();
  const visibleConversationIds = useVisibleConversationIds();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }

      if (!isElectronDesktop()) {
        return;
      }

      if (isConversationTabShortcut(event)) {
        event.preventDefault();
        const currentConversationId = location.pathname.match(/^\/conversation\/([^/]+)/)?.[1] ?? null;
        const targetConversationId = getCycledConversationId(
          visibleConversationIds,
          currentConversationId,
          event.shiftKey ? -1 : 1
        );

        if (targetConversationId) {
          void navigate(`/conversation/${targetConversationId}`);
        }
        return;
      }

      if (isNewConversationShortcut(event)) {
        event.preventDefault();
        void navigate('/guid');
        return;
      }

      if (isPrimaryApplicationShortcut(event, { key: 'b', targetGuard: 'embedded-editor' })) {
        event.preventDefault();
        toggleSider();
        return;
      }

      if (isPrimaryApplicationShortcut(event, { key: 'l', targetGuard: 'embedded-editor' })) {
        const handled = dispatchWorkspaceToggleEvent();
        if (handled) {
          event.preventDefault();
        }
        return;
      }

      if (
        isPrimaryApplicationShortcut(event, { key: '4', targetGuard: 'embedded-editor' }) ||
        isPrimaryApplicationShortcut(event, { key: 'o', shiftKey: true, targetGuard: 'embedded-editor' })
      ) {
        event.preventDefault();
        void navigate('/organization');
        return;
      }

      if (
        isPrimaryApplicationShortcut(event, { key: 'd', shiftKey: true, targetGuard: 'embedded-editor' }) ||
        isPrimaryApplicationShortcut(event, { key: 't', shiftKey: true, targetGuard: 'embedded-editor' })
      ) {
        event.preventDefault();
        toggleTheme?.();
        return;
      }

      if (
        isPrimaryApplicationShortcut(event, { key: '/', targetGuard: 'embedded-editor' }) ||
        isPrimaryApplicationShortcut(event, { key: '?', targetGuard: 'embedded-editor' }) ||
        (isPlatformPrimaryModifier(event) && (event.key === '?' || event.key === '/'))
      ) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('aionui:toggle-shortcut-map'));
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [location.pathname, navigate, toggleSider, toggleTheme, visibleConversationIds]);
};
