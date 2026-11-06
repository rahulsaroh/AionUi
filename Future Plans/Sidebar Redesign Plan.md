# Organization Sidebar Professional UI/UX Redesign Plan

## 1. Executive Summary & Problem Analysis

Based on the review of the current sidebar implementation in [`OrganizationSiderContent.tsx`](file:///e:/Rahul/Personal/AIonUI/packages/desktop/src/renderer/components/layout/Sider/OrganizationSiderContent.tsx) and [`ScopeSegmentedToggle.tsx`](file:///e:/Rahul/Personal/AIonUI/packages/desktop/src/renderer/components/layout/Sider/ScopeSegmentedToggle.tsx), several key visual and structural defects cause the sidebar to appear unpolished and amateurish:

1. **Unstyled Raw `<button>` Elements**:
   - Violates project rules in `AGENTS.md` (no raw HTML interactive elements).
   - In Electron/Chromium, `<button>` tags without CSS resets render with browser-default stark white rectangular backgrounds (`buttonface`), creating harsh white blocks on "+ New chat" and the "Teams | Projects" sub-tabs in dark mode.
2. **Raw Emojis & Inconsistent Iconography**:
   - Emojis (`👑`, `🗺️`, `💼`, `🏢`, `⏱️`) conflict with the rest of AionUi's clean `@icon-park/react` monochrome SVG aesthetic.
3. **Candy/Gaudy Gradients**:
   - The "Talk to Root CEO" button uses an uncalibrated rainbow gradient (`from-amber-500/15 via-primary/10 to-emerald-500/15`) with high-contrast text that looks like a prototype or mobile ad rather than enterprise software.
4. **Boxy & Cluttered Visual Hierarchy**:
   - Every department is wrapped in an individual heavy-bordered container card (`bg-[var(--color-bg-2)]` + `border`), creating visual fatigue and taking up too much vertical space.
   - The tree hierarchy (Depts → Teams/Projects → Chats) lacks modern spacing, proper indentation guidelines, and cohesive typography.
5. **Cramped Search & Filter Bar**:
   - The search input is undersized (`h-26px text-10px`) with no search icon, and filter tags (`all`, `active`, `dormant`, `shared`) sit awkwardly above department lists.

---

## 2. Design System & Visual Target

The redesign aligns with the established design language of Linear, VSCode Explorer, and AionUi's core design system (`@arco-design/web-react` + UnoCSS semantic tokens):

```
┌───────────────────────────────────────────────┐
│ [ 💼 Workplace ]     [ 🏢 Organization ]      │ ← Sleek segmented pill
├───────────────────────────────────────────────┤
│ [ 👑 Talk to Root CEO                   Ctrl+K] │ ← Premium executive command bar
│   🗺️ 2D Org-Chart Canvas                 Live │ ← Clean navigation row
│   ⏱️ Org Automations                 2 active │ ← Uniform secondary nav row
├───────────────────────────────────────────────┤
│ [ 🔍 Search departments, teams, projects... ] │ ← Polished search input
│  (All)  (Active)  (Dormant)  (Shared)         │ ← Modern micro-filter pills
├───────────────────────────────────────────────┤
│ DEPARTMENTS (5)                               │ ← Subtle category header
│                                               │
│ ▼ 🏢 App Builder Department        [+ Project]│ ← Refined tree header
│   │                                           │
│   ├── 📁 AionUi Custom Fork          (Active) │ ← Project folder row
│   │   │  • Chat Just now                      │ ← Conversation row
│   │   │  • App Builder -> Core Team...        │
│   │   └── + New Chat                          │ ← Ghost button (no white box!)
│   │                                           │
│   └── 📁 Gym Mentor App              (Active) │
│       └── + New Chat                          │
└───────────────────────────────────────────────┘
```

---

## 3. Step-by-Step Implementation Plan

### Phase 1: Mode Switcher & Navigation Header (`ScopeSegmentedToggle.tsx`)

- **Replace Emojis with IconPark SVGs**:
  - Workplace: `<Laptop size={14} />` or `<ApplicationTwo size={14} />`
  - Organization: `<NetworkTree size={14} />` or `<Peoples size={14} />`
- **Modern Segmented Pill**:
  - Container: `bg-fill-2 p-3px rd-8px border border-[var(--color-border-2)]`
  - Inactive item: `text-t-secondary hover:text-t-primary hover:bg-fill-3`
  - Active item: `bg-[var(--color-bg-2)] text-primary shadow-xs font-semibold`
  - Full keyboard accessibility and zero raw `<button>` tags.

### Phase 2: Executive Directive & Primary Actions (`OrganizationSiderContent.tsx`)

- **Revamp "Talk to Root CEO" Action**:
  - Transition from loud multi-color gradient to a sophisticated command card.
  - Background: subtle warm or primary tint (`bg-[rgba(var(--primary-6),0.08)]` with hover `bg-[rgba(var(--primary-6),0.14)]`).
  - Icon: Refined golden/amber crown or executive avatar icon from `@icon-park/react`.
  - Label: Clean 13px medium weight with an executive subtitle or shortcut badge (`⌘K` or `Enter`).
- **Standardize Canvas & Automations Rows**:
  - Convert to standard 32px height rows matching `SiderItem` and `SiderPrimaryNav`.
  - Use proper `@icon-park/react` icons (`NetworkTree`, `AlarmClock`).
  - Replace raw badges with subtle semantic badge tokens (`bg-fill-2 text-t-tertiary` or subtle cyan pill).

### Phase 3: Search, Filters & Drilldown Breadcrumb

- **Search Bar**:
  - Upgrade Arco `<Input>` to `h-28px`, rounded-6px, with a prefix `<Search size={13} className="text-t-tertiary" />`.
- **Status Filter Segment**:
  - Convert raw Arco `Tag` components to a unified segmented pill filter bar (`All`, `Active`, `Dormant`, `Shared`) with smooth active indicator and count badges.
- **Drilldown Navigation**:
  - If a department or team is selected, show an elegant breadcrumb bar with single-click reset (`Clear`).

### Phase 4: Department & Team Tree Structure

- **Eliminate Heavy Isolated Box Cards**:
  - Replace the heavy card borders with a clean collapsible tree hierarchy.
  - Department row:
    - Subtle hover disclosure (`Right` / `Down` arrow).
    - Status dot (Active / Idle / Dormant) using theme palette border color.
    - Department title in `text-12px font-semibold text-t-primary`.
    - Segmented Sub-tab toggle (`Teams` | `Projects`) styled with clean micro-pills instead of raw buttons.
    - Quick actions on hover: `+ Project`, `+ Team`, `Edit`.
- **Tree Line Guides**:
  - Add delicate tree guide lines (`border-l border-[var(--color-border-2)]`) for child teams, projects, and chats.

### Phase 5: Projects & Conversation Rows (+ New Chat Fix)

- **Fix Stark White "+ New chat" Box**:
  - Replace `<button>` with an Arco-compliant interactive `div role="button"` styled as a subtle ghost row:
    - `h-24px px-8px text-11px text-t-tertiary hover:text-primary hover:bg-fill-2 rounded-4px cursor-pointer flex items-center gap-6px transition-colors`.
  - Fix any unstyled white background on empty project states ("No chats yet").
- **Conversation Items**:
  - Distinct active state when selected (`bg-primary/10 text-primary border-l-2 border-primary`).
  - Title and relative timestamp neatly spaced.
  - Agent / Team badge in muted micro-tag (`text-9px text-t-tertiary`).

### Phase 6: Verification & Quality Assurance

- Run `bunx tsc --noEmit` to verify strict TypeScript adherence.
- Run `bun run lint:fix` and `bun run format` to ensure compliance with Oxlint and Oxfmt rules.
- Run `bun run test` to guarantee no regressions in organization or sidebar tests.

---

## 4. Key Improvements at a Glance

| Feature                       | Current State                            | Redesigned State                                |
| :---------------------------- | :--------------------------------------- | :---------------------------------------------- |
| **New Chat Button**           | Harsh white solid rectangle (`<button>`) | Elegant ghost action row with hover tint        |
| **Sub-tabs (Teams/Projects)** | Mismatched unstyled buttons              | Micro segmented pill switch                     |
| **Talk to Root CEO**          | Rainbow gradient + emoji `👑`            | Sleek executive command card                    |
| **Mode Switcher**             | Heavy box with raw emojis `💼` / `🏢`    | Crisp IconPark icons + smooth segmented control |
| **Hierarchy**                 | Clunky heavy cards with borders          | Modern VSCode/Linear style tree structure       |
| **Icons**                     | Emojis & mismatched sizes                | 100% `@icon-park/react` with consistent sizing  |
| **Rule Compliance**           | Contains raw HTML `<button>`             | Strictly complies with `AGENTS.md` & Arco       |
