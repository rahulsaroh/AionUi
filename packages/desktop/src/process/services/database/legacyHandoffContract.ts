export type LegacyHandoffColumn = {
  table: string;
  column: string;
  definition: string;
};

export const LEGACY_HANDOFF_COLUMNS: readonly LegacyHandoffColumn[] = [
  { table: 'cron_jobs', column: 'skill_content', definition: 'TEXT' },
  { table: 'cron_jobs', column: 'description', definition: 'TEXT' },
  { table: 'conversations', column: 'pinned', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'conversations', column: 'pinned_at', definition: 'INTEGER' },
  { table: 'teams', column: 'session_mode', definition: 'TEXT' },
  { table: 'teams', column: 'agents_version', definition: "TEXT NOT NULL DEFAULT '1.0.0'" },
  { table: 'teams', column: 'parent_id', definition: 'TEXT NULL' },
  { table: 'teams', column: 'department_role', definition: 'TEXT NULL' },
  { table: 'teams', column: 'description', definition: 'TEXT NULL' },
];
