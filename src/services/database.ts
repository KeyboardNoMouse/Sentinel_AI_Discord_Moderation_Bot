import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import path from "path";
import fs from "fs";
import { logger } from "../utils/logger";
import type { UserProfile, Incident, Appeal, BotConfig } from "../types";

const DB_PATH = path.join(process.cwd(), "data", "sentinel.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let db: SqlJsDatabase;

// Persist DB to disk
function saveDb() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

export async function initDb(): Promise<void> {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      userId TEXT NOT NULL,
      guildId TEXT NOT NULL,
      warningCount INTEGER DEFAULT 0,
      timeoutCount INTEGER DEFAULT 0,
      toxicityScore REAL DEFAULT 0,
      lastOffenseAt INTEGER,
      flaggedMessages INTEGER DEFAULT 0,
      joinedAt INTEGER NOT NULL,
      notes TEXT DEFAULT '',
      PRIMARY KEY (userId, guildId)
    );

    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      guildId TEXT NOT NULL,
      channelId TEXT NOT NULL,
      triggeredBy TEXT NOT NULL,
      involvedUsers TEXT NOT NULL,
      severity TEXT NOT NULL,
      categories TEXT NOT NULL,
      summary TEXT NOT NULL,
      messageSnapshot TEXT NOT NULL,
      actionTaken TEXT NOT NULL,
      resolvedAt INTEGER,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS appeals (
      id TEXT PRIMARY KEY,
      guildId TEXT NOT NULL,
      userId TEXT NOT NULL,
      incidentId TEXT,
      message TEXT NOT NULL,
      aiAssessment TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      reviewedBy TEXT,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bot_config (
      guildId TEXT PRIMARY KEY,
      modChannelId TEXT,
      logChannelId TEXT,
      autoModEnabled INTEGER DEFAULT 1,
      escalationThreshold INTEGER DEFAULT 5,
      crisisAlertEnabled INTEGER DEFAULT 1,
      raidProtectionEnabled INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS message_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guildId TEXT NOT NULL,
      channelId TEXT NOT NULL,
      userId TEXT NOT NULL,
      content TEXT NOT NULL,
      toxicityScore REAL DEFAULT 0,
      flagged INTEGER DEFAULT 0,
      createdAt INTEGER NOT NULL
    );
  `);

  saveDb();
  logger.info("Database initialized");
}

function getRows<T>(query: string, params: any[] = []): T[] {
  const stmt = db.prepare(query);
  stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return rows;
}

function getRow<T>(query: string, params: any[] = []): T | undefined {
  const rows = getRows<T>(query, params);
  return rows[0];
}

function run(query: string, params: any[] = []): void {
  db.run(query, params);
  saveDb();
}

// ── User Profiles ────────────────────────────────────────────────────────────

export function getOrCreateProfile(userId: string, guildId: string): UserProfile {
  const existing = getRow<UserProfile>(
    "SELECT * FROM user_profiles WHERE userId = ? AND guildId = ?",
    [userId, guildId]
  );
  if (existing) return existing;

  const now = Date.now();
  run(
    `INSERT INTO user_profiles (userId, guildId, warningCount, timeoutCount, toxicityScore, lastOffenseAt, flaggedMessages, joinedAt, notes)
     VALUES (?, ?, 0, 0, 0, NULL, 0, ?, '')`,
    [userId, guildId, now]
  );
  return getRow<UserProfile>(
    "SELECT * FROM user_profiles WHERE userId = ? AND guildId = ?",
    [userId, guildId]
  )!;
}

export function incrementWarning(userId: string, guildId: string, toxicityDelta: number): void {
  run(
    `UPDATE user_profiles SET warningCount = warningCount + 1, flaggedMessages = flaggedMessages + 1,
     toxicityScore = MIN(100, toxicityScore + ?), lastOffenseAt = ? WHERE userId = ? AND guildId = ?`,
    [toxicityDelta, Date.now(), userId, guildId]
  );
}

export function getTopRiskUsers(guildId: string, limit = 10): UserProfile[] {
  return getRows<UserProfile>(
    "SELECT * FROM user_profiles WHERE guildId = ? ORDER BY toxicityScore DESC LIMIT ?",
    [guildId, limit]
  );
}

// ── Incidents ────────────────────────────────────────────────────────────────

export function createIncident(incident: Incident): void {
  run(
    `INSERT INTO incidents (id, guildId, channelId, triggeredBy, involvedUsers, severity, categories, summary, messageSnapshot, actionTaken, resolvedAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      incident.id, incident.guildId, incident.channelId, incident.triggeredBy,
      JSON.stringify(incident.involvedUsers), incident.severity,
      JSON.stringify(incident.categories), incident.summary,
      incident.messageSnapshot, incident.actionTaken,
      incident.resolvedAt, incident.createdAt,
    ]
  );
}

export function getRecentIncidents(guildId: string, limit = 10): Incident[] {
  const rows = getRows<any>(
    "SELECT * FROM incidents WHERE guildId = ? ORDER BY createdAt DESC LIMIT ?",
    [guildId, limit]
  );
  return rows.map(r => ({
    ...r,
    involvedUsers: JSON.parse(r.involvedUsers),
    categories: JSON.parse(r.categories),
  }));
}

export function getUserIncidents(userId: string, guildId: string): Incident[] {
  const rows = getRows<any>(
    "SELECT * FROM incidents WHERE guildId = ? AND triggeredBy = ? ORDER BY createdAt DESC LIMIT 20",
    [guildId, userId]
  );
  return rows.map(r => ({
    ...r,
    involvedUsers: JSON.parse(r.involvedUsers),
    categories: JSON.parse(r.categories),
  }));
}

// ── Appeals ──────────────────────────────────────────────────────────────────

export function createAppeal(appeal: Appeal): void {
  run(
    `INSERT INTO appeals (id, guildId, userId, incidentId, message, aiAssessment, status, reviewedBy, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [appeal.id, appeal.guildId, appeal.userId, appeal.incidentId,
     appeal.message, appeal.aiAssessment, appeal.status, appeal.reviewedBy, appeal.createdAt]
  );
}

export function getPendingAppeals(guildId: string): Appeal[] {
  return getRows<Appeal>(
    "SELECT * FROM appeals WHERE guildId = ? AND status = 'pending' ORDER BY createdAt ASC",
    [guildId]
  );
}

export function updateAppealStatus(id: string, status: "approved" | "denied", reviewedBy: string): void {
  run("UPDATE appeals SET status = ?, reviewedBy = ? WHERE id = ?", [status, reviewedBy, id]);
}

// ── Config ───────────────────────────────────────────────────────────────────

export function getConfig(guildId: string): BotConfig {
  const existing = getRow<any>("SELECT * FROM bot_config WHERE guildId = ?", [guildId]);
  if (existing) {
    return {
      ...existing,
      autoModEnabled: !!existing.autoModEnabled,
      crisisAlertEnabled: !!existing.crisisAlertEnabled,
      raidProtectionEnabled: !!existing.raidProtectionEnabled,
    };
  }

  run(
    `INSERT INTO bot_config (guildId, autoModEnabled, escalationThreshold, crisisAlertEnabled, raidProtectionEnabled)
     VALUES (?, 1, 5, 1, 1)`,
    [guildId]
  );

  return {
    guildId, modChannelId: null, logChannelId: null,
    autoModEnabled: true, escalationThreshold: 5,
    crisisAlertEnabled: true, raidProtectionEnabled: true,
  };
}

export function setConfig(guildId: string, updates: Partial<BotConfig>): void {
  const fields = Object.keys(updates).map(k => `${k} = ?`).join(", ");
  const values = [...Object.values(updates), guildId];
  run(`UPDATE bot_config SET ${fields} WHERE guildId = ?`, values);
}

// ── Message log ──────────────────────────────────────────────────────────────

export function logMessage(guildId: string, channelId: string, userId: string, content: string, toxicityScore = 0, flagged = false): void {
  run(
    `INSERT INTO message_log (guildId, channelId, userId, content, toxicityScore, flagged, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [guildId, channelId, userId, content.slice(0, 1000), toxicityScore, flagged ? 1 : 0, Date.now()]
  );
}

export function getRecentMessages(channelId: string, limit = 50): any[] {
  return getRows("SELECT * FROM message_log WHERE channelId = ? ORDER BY createdAt DESC LIMIT ?", [channelId, limit]);
}
