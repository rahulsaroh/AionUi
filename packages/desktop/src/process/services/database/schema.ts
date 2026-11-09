/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ISqliteDriver } from './drivers/ISqliteDriver';

/**
 * Initialize the current legacy DB baseline for newly-created Electron DBs.
 *
 * `CREATE TABLE IF NOT EXISTS` does not repair existing tables. Keep
 * `repairLegacyHandoffSchema()` as the handoff contract enforcement path.
 */
export function initSchema(db: ISqliteDriver): void {
  // Enable foreign keys
  db.pragma('foreign_keys = ON');
  // Wait up to 5 seconds when the database is locked by another connection
  // instead of failing immediately (prevents "database is locked" errors
  // when multiple processes or startup tasks access the database concurrently)
  db.pragma('busy_timeout = 5000');
  // Enable Write-Ahead Logging for better performance
  try {
    db.pragma('journal_mode = WAL');
  } catch (error) {
    console.warn('[Database] Failed to enable WAL mode, using default journal mode:', error);
    // Continue with default journal mode if WAL fails
  }

  // Users table (账户系统)
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    avatar_path TEXT,
    jwt_secret TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_login INTEGER
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');

  // Conversations table (会话表 - 存储TChatConversation)
  db.exec(`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    extra TEXT NOT NULL DEFAULT '{}',
    model TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'finished')),
    source TEXT,
    channel_chat_id TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    pinned_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(type)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at DESC)');

  // Messages table (消息表 - 存储TMessage)
  db.exec(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    msg_id TEXT,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    position TEXT CHECK(position IN ('left', 'right', 'center', 'pop')),
    status TEXT CHECK(status IN ('finish', 'pending', 'error', 'work')),
    created_at INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(type)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_msg_id ON messages(msg_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at)');

  // Teams table (团队模式)
  db.exec(`CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    workspace TEXT NOT NULL,
    workspace_mode TEXT NOT NULL DEFAULT 'shared',
    agents TEXT NOT NULL DEFAULT '[]',
    lead_agent_id TEXT,
    session_mode TEXT,
    agents_version TEXT NOT NULL DEFAULT '1.0.0',
    parent_id TEXT NULL,
    department_role TEXT NULL,
    description TEXT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_teams_user_id ON teams(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_teams_parent_id ON teams(parent_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_teams_updated_at ON teams(updated_at)');

  // Mailbox table (团队消息邮箱)
  db.exec(`CREATE TABLE IF NOT EXISTS mailbox (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    to_agent_id TEXT NOT NULL,
    from_agent_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'message',
    content TEXT NOT NULL,
    summary TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_mailbox_to ON mailbox(team_id, to_agent_id, read)');

  // Team tasks table (团队任务)
  db.exec(`CREATE TABLE IF NOT EXISTS team_tasks (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    owner TEXT,
    blocked_by TEXT NOT NULL DEFAULT '[]',
    blocks TEXT NOT NULL DEFAULT '[]',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_team ON team_tasks(team_id, status)');

  // Autonomy profiles (自主性配置)
  db.exec(`CREATE TABLE IF NOT EXISTS autonomy_profiles (
    id TEXT PRIMARY KEY,
    scope_type TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    profile TEXT NOT NULL DEFAULT 'ask',
    max_tool_calls_per_run INTEGER DEFAULT 50,
    allowlisted_commands TEXT DEFAULT '[]',
    allowlisted_domains TEXT DEFAULT '[]',
    timeout_hours INTEGER DEFAULT 12,
    updated_at INTEGER NOT NULL,
    UNIQUE(scope_type, scope_id)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_autonomy_profiles_scope ON autonomy_profiles(scope_type, scope_id)');

  // Remembered rules (记住的审批规则)
  db.exec(`CREATE TABLE IF NOT EXISTS remembered_rules (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    pattern TEXT NOT NULL,
    action_type TEXT,
    created_at INTEGER NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_remembered_rules_project ON remembered_rules(project_id)');

  // Headless gates (无头任务闸门)
  db.exec(`CREATE TABLE IF NOT EXISTS headless_gates (
    id TEXT PRIMARY KEY,
    job_id TEXT,
    conversation_id TEXT NOT NULL,
    call_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting_for_approval',
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_headless_gates_status ON headless_gates(status)');

  // Approval audit logs (审批审计日志)
  db.exec(`CREATE TABLE IF NOT EXISTS approval_audit_logs (
    id TEXT PRIMARY KEY,
    confirmation_id TEXT,
    conversation_id TEXT,
    project_id TEXT,
    team_id TEXT,
    action TEXT,
    action_type TEXT,
    decision TEXT NOT NULL,
    decision_by TEXT NOT NULL,
    channel TEXT NOT NULL,
    details TEXT,
    created_at INTEGER NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_approval_audit_logs_created ON approval_audit_logs(created_at DESC)');

  console.log('[Database] Schema initialized successfully');
}

/**
 * Get database version for migration tracking
 * Uses SQLite's built-in user_version pragma
 */
export function getDatabaseVersion(db: ISqliteDriver): number {
  try {
    const result = db.pragma('user_version', { simple: true }) as number;
    return result;
  } catch {
    return 0;
  }
}

/**
 * Set database version
 * Uses SQLite's built-in user_version pragma
 */
export function setDatabaseVersion(db: ISqliteDriver, version: number): void {
  db.pragma(`user_version = ${version}`);
}

/**
 * Current database schema version
 * Update this when adding new migrations in migrations.ts
 */
export const CURRENT_DB_VERSION = 28;
