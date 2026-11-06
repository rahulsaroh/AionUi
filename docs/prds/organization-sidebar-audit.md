# AionUi — Organization Sidebar Restructure: Step 0 Audit & Plan

## 1. Current state (audit)

### Entities and how they link today (renderer localStorage only — NOT the Electron SQLite DB)

- `OrgHierarchy` (`aionui:org-hierarchy`): `{ rootCeo, departments[], lastUpdated }`.
- `RootCEO` (`root-ceo`): `ceoAgent` = "Global Organization CEO" (`agent-root-ceo`), `chiefOfStaffAgent`, `workspacePath: ~/AutonomousOS`.
- `OrgDepartmentNode` (5 seed depts: App Builder, YouTube Automation, Digital Product, Personal & Life Coaches, Social Media): `id, name, parentDepartmentId, departmentCeoAgent, teams[], linkedProjects[], cronSchedule?, lastActiveAt, status, description, workspacePath`. Each team holds `linkedProjectId/linkedProjectName` (1:1 with a project). No `icon`, `color`, `order`, `pmAgentId`.
- `OrgTeamNode`: `id, departmentId, name, teamLeadAgent, hrCoordinatorAgent, specialistMembers[], linkedProjectId, linkedProjectName, lastActiveAt, status, description, workspacePath`. Members are only the embedded agents; no flat `members[]`.
- `OrgProject` (12 seed projects): `id, departmentId, teamId` (SINGLE team), `description`, `status: 'active'|'completed'|'queued'`, `path`, `workspacePath`. One team per project; no `goal`, `context`, `teamIds[]`, `repos/skills`, `notes`, `done` status.
- `OrgConversation` (`aionui:org-conversations`): `{ id, title, type: 'ceo_directive'|'dept_handoff'|'team_execution', sourceNodeId, targetNodeId, timestamp, summary, messages[] }`. **Chats are attached to ORG NODES** (root-ceo / department / team ids), NOT to projects. `sourceNodeId`/`targetNodeId` carry the node ids. The sidebar "Org Conversations" section filters by selected node id.
- `OrgCronJob` (`aionui:org-cron-jobs`): Org Automations (2 active in seed).
- Backend Electron DB (`better-sqlite3`, schema.ts v27): `conversations`, `messages`, `teams`, `mailbox`, `team_tasks` — Workplace/backend data. Organization state does not touch this DB.

### How chats are attached to teams/agents today

Via `OrgConversation.sourceNodeId` / `targetNodeId` pointing at org node ids (`team-aionui`, `dept-app-builder`, `root-ceo`). There is no `projectId`, no `teamId`/`agentId` on the chat, no createdAt ordering distinct from timestamp, and no project context inheritance. The Root CEO flow: "Talk to Root CEO" → modal creates a `ceo_directive` conversation → `navigate('/organization')` → OrgDelegationEngine routes keyword-matched directives to departments/teams and simulates/real-executes agents via `ipcBridge.conversation`.

### Routing

`/organization` → `OrganizationCanvasView` (ReactFlow 2D canvas). The sidebar (`Sider/index.tsx`) renders `OrganizationSiderContent` only when `activeScope === 'organization'`. Workplace mode uses `WorkspaceGroupedHistory`/`TeamSiderSection` — untouched by org sidebar changes.

### i18n

Module `team` (in `i18n-config.json`). Existing keys `team.organization.*` in all 12 locales. `i18n:types` regenerates `i18n-keys.d.ts`; `scripts/check-i18n.js` validates key coverage (warnings only for unknown keys).

### Tooling

- Vitest 4 (root `vitest.config.ts`), node + jsdom projects; only 2 existing tests, none for org.
- `oxlint` / `oxfmt`, `tsc --noEmit` (via `bunx tsc --noEmit` per AGENTS.md).
- No DnD or virtualization libraries installed (`react-window`, `@tanstack/react-virtual`, `@dnd-kit`, `react-beautiful-dnd`, `uuid`, `nanoid` all absent).

## 2. What must change

| Area                | Today                                                                     | Target                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Department model    | name, agents, teams, linkedProjects, workspacePath                        | + `icon`, `color`, `order`, `pmAgentId` (+ inline `pmAgent` definition)                                                         |
| Team model          | agents embedded, single `linkedProjectId`                                 | + flat `members[]` (keep `specialistMembers` for back-compat)                                                                   |
| Project model       | single `teamId`, `description`, status active/completed/queued            | `teamIds[]`, `goal`, `context {repos, skills, notes}`, `workspacePath`, status active/dormant/done                              |
| Chat model          | node-attached `OrgConversation`, no project link                          | `Chat` = `OrgConversation` + `projectId` (+ optional `teamId`, `agentId`); chats belong to exactly one project                  |
| Sidebar Departments | flat team list under department; separate Projects/Conversations sections | each department: collapsible card with \*\*Teams                                                                                | Projects\*\* sub-tabs (last sub-tab remembered per dept); PM pinned atop Teams; projects list with chats (newest first) + "New chat"; empty states; "..." menus (rename/delete/move/archive); search; truncate + tooltip |
| Persistence         | collapsed state in React state only                                       | collapsed sections/depts, last opened chat, per-dept sub-tab persisted to `aionui:org-ui`                                       |
| Filter chips        | all/active/dormant/shared (applied loosely)                               | applied to departments, teams, AND projects (shared = multi-team project / member shared across teams)                          |
| All Depts view      | breadcrumb only                                                           | projects grouped by department via each department's Projects tab                                                               |
| Migration           | none                                                                      | on load v1→v2: move each team's node-attached chats into a project named after the team; create default PM agent per department |

## 3. Minimal-change plan (5 commits)

**(a) Data model + migration**

- `types/organization.ts`: add `projectManager` role; extend Department/Team/Project/Conversation per target; keep all existing fields for back-compat.
- `utils/orgMigration.ts` (new): pure v1→v2 migration (PM per dept; team chats → team-named project; `teamId`→`teamIds[]`).
- `store/useOrgStore.ts`: versioned localStorage key `aionui:org-storage-version`; run migration on load; keep existing add/update/upsert APIs working with new shape.
- `utils/defaultOrgSeed.ts`: seed PM agents, `icon/color/order`, `teamIds[]`, `goal`.
- New vitest test `tests/unit/org/orgMigration.test.ts` covering migration (chats re-parented, PMs created, idempotent, no data loss).

**(b) Departments > Teams/Projects tabs + chats under projects**

- Rewrite the Departments section of `OrganizationSiderContent.tsx`: per-department sub-tab pills (Teams/Projects, remembered per dept), PM pinned atop Teams, teams list, projects list with chats underneath (newest first), "New chat" per project, empty states, search, "..." menus, truncate+tooltip, persisted collapsed/sub-tab/last-chat UI state (`aionui:org-ui`), filter chips applied to teams and projects.
- Bridge `OrgProjectModal` to write `teamIds: [teamId]` (single-team UI for now).
- Keep Root CEO button, Org-Chart Canvas link, Org Automations button, breadcrumb, "All Depts" header untouched.

**(c) Project context**

- `OrgProjectModal`: name, goal, multi-team assignment, workspacePath default = `<dept workspacePath>/<project name>`, repos/skills/notes inputs, status active/dormant/done.
- Display goal/context on project rows; chats inherit project context (context stored on project; PM/delegation reads it in commit d).
- i18n keys for new strings + regenerate `i18n-keys.d.ts` + run `check-i18n.js`.

**(d) PM agent and delegation**

- Default PM agent per department (`role: 'project_manager'`), pinned at top of Teams tab; PM profile modal: editable system prompt, GitHub repos + skills attachments (stored on `pmAgent.metadata`).
- PM panel: list all projects/chats in department, create project/chat, assign work to a team/agent (wires `OrgDelegationEngine.executeDirective` in simulation mode), read project context + status summary.
- PM actions surface as system messages in the project chat (`addOrgMessage` store action appending to the conversation's `messages`).

**(e) Drag and drop + polish**

- Native HTML5 DnD: chat → another project; project → another department (confirm + move; archive option on delete).
- Final polish: compact rows, truncation/tooltips, empty states, lint/format/typecheck/test.

## 4. Things I will NOT change (scope guard)

- Workplace mode, `TeamSiderSection`, `WorkspaceGroupedHistory`, `/guid`, `/scheduled`, SQLite backend DB.
- Org-Chart Canvas (`OrganizationCanvasView` + node/edge components) — remains the org visualization surface; clicking a chat still navigates to `/organization` (no new route).
- Existing `OrgConversation` shape (messages stay inside the conversation) — chats are conversations re-parented to projects.

## 5. Decisions made on my own (for review)

1. Chat entity = `OrgConversation` extended with `projectId`/`teamId`/`agentId` (no separate messages table) — minimizes storage churn and preserves existing messages.
2. PM agent stored inline on the department (`pmAgent` + `pmAgentId`), new `OrgAgentRole` value `'project_manager'` — no top-level agents table.
3. `teamId` → `teamIds[]`; `team.linkedProjectId` kept in sync from `teamIds[0]` via `orgCoherence` so canvas components keep working.
4. Org state remains renderer localStorage; "migration" is a one-shot localStorage transform with version flag `aionui:org-storage-version` (no Electron DB migration).
5. No DnD/virtualization libraries: native HTML5 DnD; lists stay small (sidebar), so no virtualization.
6. "All Depts shows projects grouped by department" = each department card exposes its Projects tab at the top level; no separate All-Depts-projects section added.
7. Selecting a chat sets `lastOpenedChatId` and navigates to `/organization` (canvas), consistent with existing conversation selection.
8. Filter 'shared': projects with `teamIds.length > 1`; teams having members assigned to multiple teams; departments with cross-dept shared members.
