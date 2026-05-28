import { analyzeRaid } from "./gemini";
import { logger } from "../utils/logger";

interface JoinEvent {
  userId: string;
  username: string;
  accountAge: number; // days
  joinTime: number;
}

const recentJoins = new Map<string, JoinEvent[]>(); // guildId -> joins

export function trackJoin(guildId: string, userId: string, username: string, accountCreatedAt: Date): void {
  const accountAge = Math.floor((Date.now() - accountCreatedAt.getTime()) / (1000 * 60 * 60 * 24));
  const joins = recentJoins.get(guildId) || [];

  joins.push({ userId, username, accountAge, joinTime: Date.now() });

  // Keep only joins in the last 10 minutes
  const tenMinAgo = Date.now() - 10 * 60 * 1000;
  const filtered = joins.filter(j => j.joinTime > tenMinAgo);
  recentJoins.set(guildId, filtered);
}

export async function checkRaid(guildId: string): Promise<{ isRaid: boolean; confidence: number; reasoning: string; joinCount: number }> {
  const joins = recentJoins.get(guildId) || [];

  // Need at least 5 joins in 10 minutes to consider a raid
  if (joins.length < 5) {
    return { isRaid: false, confidence: 0, reasoning: "Not enough joins to analyze", joinCount: joins.length };
  }

  try {
    const result = await analyzeRaid(joins.map(j => ({
      username: j.username,
      accountAge: j.accountAge,
      joinTime: j.joinTime,
    })));

    return { ...result, joinCount: joins.length };
  } catch (err) {
    logger.error(`checkRaid failed: ${err}`);
    return { isRaid: false, confidence: 0, reasoning: "Analysis failed", joinCount: joins.length };
  }
}

export function clearJoins(guildId: string): void {
  recentJoins.delete(guildId);
}
