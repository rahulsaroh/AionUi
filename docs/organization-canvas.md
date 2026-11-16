# Organization Canvas & 2D Org-Chart Architecture

## Overview

The 2D Org-Chart Canvas is an interactive visual command center for the organization. It models leadership hierarchy, department structures, projects, sub-teams, and shared cross-functional specialists.

The canvas is built on `@xyflow/react` v12 and `dagre` layout engine, supplemented by custom upward status propagation and CSS keyframe animations.

---

## 1. 5-Tier Layout Hierarchy

The canvas organizes nodes into 5 horizontal tiers (from top to bottom):

```
       [ Tier 1: Root CEO ]
                 │
      ┌──────────┴──────────┐
[ Tier 2: Dept A ]    [ Tier 2: Dept B ]
      │                     │
[ Tier 3: Project ]   [ Tier 3: Project ]
      │                     │
[ Tier 4: Team A1 ]   [ Tier 4: Team B1 ]
      ▲                     ▲
      │ (Dashed Tethers)    │
[ Tier 5: Shared Cross-Functional Pool Members Strip ]
```

1. **Tier 1: Root CEO Card (`RootCeoNode`)**
   - Centered at the top.
   - Features robot executive avatar, user/organization name, model selector, workspace folder link, and dispatch button.
   - Distinctive **cyan neon glow** border (`#06B6D4`).

2. **Tier 2: Department Cards (`DepartmentNode`)**
   - Horizontal row below Root CEO.
   - Visualized with per-department accent colors auto-assigned from an 8-color palette (`#3B82F6`, `#14B8A6`, `#8B5CF6`, `#10B981`, `#F59E0B`, `#EC4899`, `#6366F1`, `#06B6D4`).
   - Displays department icon, VP head, active project/team count, and expand/collapse controls.

3. **Tier 3: Project Cards (`ProjectNode`)**
   - Positioned directly below their parent department and above their linked execution teams.
   - Purple neon border (`#A855F7`) with scope tag and folder link.

4. **Tier 4: Team Cards (`TeamNode`)**
   - Positioned under their respective project or department.
   - Emerald neon border (`#10B981`).
   - Displays team lead, live status indicator, and a row of up to 3 member avatars with a `+N` overflow chip.

5. **Tier 5: Shared Members Bottom Strip (`SharedMemberNode`, `SharedMemberHeaderNode`)**
   - Manually positioned as a centered strip below the deepest team rank.
   - Contains specialists serving across 2+ teams/departments.
   - Displays avatar, name, list of departments served, and cross-functional role badge.
   - Connected via dashed tethers to every team/project they participate in.

---

## 2. Connectors & Edges

1. **Delegation Edges (`DelegationEdge`)**
   - Orthogonal smooth-step elbow connectors routing between Root CEO → Department → Project → Team.
   - Tinted using the parent department's accent color.
   - Features animated traveling pulse lights (`stroke-dashoffset`) during active execution.

2. **Shared Member Tethers (`SharedMemberTetherEdge`)**
   - Smooth cubic bezier connectors routing from the bottom strip upward to teams and projects.
   - Assigned a distinct, deterministic color per specialist.
   - Low default opacity (`0.22`) to avoid clutter.
   - Renders at `zIndex: -1` behind cards to ensure all node cards and handles remain interactive.
   - Hovering or selecting any member elevates their tethers to full opacity (`1.0`) with drop-shadow glow while dimming other tethers.

---

## 3. Status Colors & Visual Semantics

| Status               | Border / Accent     | Glow Effect                                         | Behavior                             |
| :------------------- | :------------------ | :-------------------------------------------------- | :----------------------------------- |
| `working`            | `#34D399` (Emerald) | Pulsing cyan/emerald neon glow (`pulseWorkingGlow`) | Live execution; animated typing dots |
| `error`              | `#EF4444` (Red)     | Static red glow (`#EF4444`)                         | Run halted or failed                 |
| `queued_next`        | `#F59E0B` (Amber)   | Slow amber breathing pulse (`pulseQueued`)          | Next in execution pipeline           |
| `recently_finished`  | `#2DD4BF` (Teal)    | Brief green flash fading to idle in 2s              | Just completed execution             |
| `department_standby` | `#FBBF24` (Gold)    | Gold standby ring                                   | Department orchestrating child run   |
| `idle`               | `#334155` (Slate)   | None                                                | Ready for tasks                      |
| `dormant`            | `#27272A` (Dim)     | Grayscale dimmed (`0.45` opacity)                   | Unused for 7+ days                   |

---

## 4. Glow Propagation Rules

When a member is executing a task, status propagates upward:

1. **Direct Card Glow**: The working agent member glows with an active pulsing ring and typing indicator.
2. **Upward Ancestor Propagation**:
   - The member's **Team Card** glows.
   - If linked to a project, the **Project Card** glows.
   - The parent **Department Card** glows.
   - The **Root CEO Card** glows.
3. **Path Edge Animation**:
   - Delegation edges linking the Root CEO down to the active member animate with a traveling dash (`stroke-dashoffset`).
   - If the active worker is a shared pool member, both their bottom strip card, team avatar chip, and upward dashed tethers animate simultaneously.
4. **Precedence with Selection & Hover**:
   - Hovering or selecting a node dims unrelated edges, but **active working paths never dim below minimum visibility**.
5. **Animation Throttling**:
   - When more than 15 paths are simultaneously active (`exceedsAnimationLimit`), continuous stroke-dash animations halt and switch to static bright glowing paths to maintain 60 FPS rendering.

---

## 5. Inactivity Timeout & Stale State Protection

To prevent agents from remaining stuck in the `working` state after app reloads, network dropouts, or crashes:

- **Inactivity-Based Timeout**: Set to **10 minutes** of zero activity (`INACTIVITY_TIMEOUT_MS = 600_000ms`).
- **Activity Refresh**: Any streamed response chunk, tool call, telemetry update, or delegation step calls `touchNodeActivity(nodeId)` to reset the 10-minute countdown.
- **Auto-Reset**: After 10 minutes of silence, the store automatically resets the node back to `idle`.

---

## 6. Automations & Cron Jobs Status Wiring

When scheduled automations (`OrgCronJob`) run:

1. `runOrgCronJob(jobId)` is invoked (or `ipcBridge.cron.onJobExecuted` fires).
2. The target department head, Root CEO, and primary team lead transition to `working`.
3. Upon completion, they transition to `recently_finished`, and then automatically fade back to `idle` after 2000ms.

---

## 7. Adding New Node Statuses

To introduce a new lifecycle status (e.g. `paused`, `review_required`):

1. Add the string literal to `OrgNodeStatus` in `packages/desktop/src/types/organization.ts`.
2. Add the visual theme mapping in `packages/desktop/src/renderer/pages/organization/utils/orgTheme.ts` under `ORG_THEME_PALETTE`.
3. Add any custom CSS keyframes or classes in `packages/desktop/src/renderer/pages/organization/orgGlow.css`.
4. Update `computeOrgStatusPropagation.ts` if the new status should propagate to ancestors.
5. Update custom memo comparators (`areTeamPropsEqual`, etc.) to track status changes.

---

## 8. Dev Simulator

In development builds (`import.meta.env.DEV`), the bottom canvas toolbar includes a **Simulate Glow** dropdown:

- **Simulate Working Member**: Sets a leaf member to `working` to preview live upward propagation, edge lights, and avatar pulses.
- **Simulate Error**: Simulates a task failure with static red glow.
- **Simulate Queued**: Previews amber breathing pulse.
- **Reset All to Idle**: Instantly returns all nodes to idle.
  _Note_: This control is stripped from production release builds.
