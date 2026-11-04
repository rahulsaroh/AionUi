# AionUi Enhancement Report & Implementation Roadmap

**Date**: 2026-11-02  
**Target Platform**: Electron Desktop (React 19 / TypeScript / Arco Design / UnoCSS)

---

## 1. Executive Summary & Codebase Audit

AionUi is a multi-agent desktop workbench orchestrating various agent runtimes (`aionrs`, `acp`, `gemini`, `legacy`), MCP tool servers, skill repositories, cron triggers, browser automation, and gateway routing.

An audit of the existing codebase confirms that several standard features already exist in deep or command-based forms:

- **Speech-to-Text**: Present via `SpeechInputButton` using Web Speech / provider speech APIs.
- **Code Block Actions**: Syntax highlighting and clipboard copy exist in `CodeBlock.tsx`.
- **Conversation Search**: Full history search popover exists in `ConversationSearchPopover.tsx`.
- **Chat Export**: Exists as a slash command (`/export`) via `useConversationExport.tsx`.
- **Scheduled Tasks**: Background cron execution and chat timeline indicators (`MessageCronTrigger.tsx`) exist.

However, key usability gaps remain—primarily around **discoverability**, **productivity shortcuts**, **one-click workflows**, and **operational feedback** (e.g. MCP latency, quota visualization).

---

## 2. Enhancement Specifications

### Phase 1: High-Priority Discoverability & Productivity (Immediate)

#### Enhancement 1: Keyboard Shortcuts Cheat Sheet Modal (`Ctrl+/` or `Cmd+/`)

- **Problem**: Users are unaware of existing shortcuts (`Ctrl+T` for new chat, `Ctrl+B` for sidebar toggle, `Ctrl+L` for workspace toggle, `Ctrl+Tab` for switching conversations).
- **Solution**: A clean Arco `Modal` triggered globally by `Ctrl+/` (Windows/Linux) or `Cmd+/` (macOS), listing all registered app hotkeys grouped by category (Navigation, Chat, Appearance).
- **Files**:
  - `packages/desktop/src/renderer/components/modal/ShortcutsModal/`
  - `packages/desktop/src/renderer/hooks/ui/useConversationShortcuts.ts`
  - i18n keys in `locales/en/` and `locales/zh_CN/`

#### Enhancement 2: Header Export Button for Conversations

- **Problem**: Conversation export is hidden behind `/export` slash command; non-technical users cannot find it.
- **Solution**: Surface an "Export as Markdown" action directly in the conversation header actions / extra menu, calling the existing export pipeline.
- **Files**:
  - `packages/desktop/src/renderer/pages/conversation/components/ChatLayout/`

#### Enhancement 3: Dark/Light Mode Hotkey (`Ctrl+Shift+D`)

- **Problem**: Switching themes currently requires navigating to Settings > Appearance or clicking through sider menu on desktop.
- **Solution**: Add global `Ctrl+Shift+D` shortcut that toggles between dark and light themes smoothly.
- **Files**:
  - `packages/desktop/src/renderer/hooks/ui/useConversationShortcuts.ts`
  - `packages/desktop/src/renderer/utils/theme/applyTheme.ts`

---

### Phase 2: Agent, Tools & Skills Enhancements

#### Enhancement 4: MCP Server Ping / Health Status Check

- **Problem**: In `ToolsSettings`, MCP servers are listed, but users have no live indicator whether a server is responding or failing without starting a prompt.
- **Solution**: Add a "Test Connection" button beside configured MCP servers to ping the process/SSE endpoint and show round-trip latency.
- **Files**:
  - `packages/desktop/src/renderer/pages/settings/ToolsSettings/McpManagement.tsx`

#### Enhancement 5: Skill Usage Telemetry & Quick Counter

- **Problem**: Users install skills into the hub but have no visibility into how often each skill is executed or invoked by assistants.
- **Solution**: Surface invocation counts and last-used timestamps on skill cards in `SkillsHubSettings.tsx`.
- **Files**:
  - `packages/desktop/src/renderer/pages/settings/SkillsSettings/SkillsHubSettings.tsx`

---

### Phase 3: Gateway & Operations Enhancements

#### Enhancement 6: Gateway Quota Visual Progress

- **Problem**: Gateway quota tab lists raw numbers without visual threshold warnings (e.g. 80% quota reached).
- **Solution**: Add Arco `Progress` bars indicating percentage utilized with color shifting (blue -> orange -> red).
- **Files**:
  - `packages/desktop/src/renderer/pages/settings/GatewaySettings/`

---

## 3. Implementation Order

| Step  | Enhancement                                       | Effort  | Risk |     Status      |
| :---: | :------------------------------------------------ | :-----: | :--: | :-------------: |
| **1** | Keyboard Shortcuts Cheat Sheet Modal (`Ctrl+/`)   | 15 mins | Low  | **In Progress** |
| **2** | Dark/Light Quick Toggle Shortcut (`Ctrl+Shift+D`) | 5 mins  | Low  |     Pending     |
| **3** | Direct Conversation Export Button in Header       | 15 mins | Low  |     Pending     |
| **4** | MCP Server Health / Ping Test                     | 25 mins | Med  |     Pending     |
| **5** | Skill Usage Analytics Badges                      | 20 mins | Low  |     Pending     |
| **6** | Gateway Quota Usage Progress Bar                  | 15 mins | Low  |     Pending     |
