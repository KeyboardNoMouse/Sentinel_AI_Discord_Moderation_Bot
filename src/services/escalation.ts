import { analyzeEscalation } from "./gemini";
import { logger } from "../utils/logger";
import type { EscalationState } from "../types";

// In-memory escalation state per channel
const escalationMap = new Map<string, EscalationState>();

// Recent messages buffer per channel (last 20 msgs)
const messageBuffer = new Map<string, string[]>();

export function trackMessage(
  guildId: string,
  channelId: string,
  userId: string,
  username: string,
  content: string,
  isHostile: boolean
): EscalationState {
  const key = `${guildId}:${channelId}`;

  // Update message buffer
  const buffer = messageBuffer.get(key) || [];
  buffer.push(`${username}: ${content}`);
  if (buffer.length > 20) buffer.shift();
  messageBuffer.set(key, buffer);

  // Get or create escalation state
  let state = escalationMap.get(key);
  if (!state) {
    state = {
      guildId,
      channelId,
      messageCount: 0,
      hostileCount: 0,
      participants: [],
      startedAt: Date.now(),
      lastUpdated: Date.now(),
      slowmodeActive: false,
    };
  }

  state.messageCount++;
  state.lastUpdated = Date.now();

  if (isHostile) {
    state.hostileCount++;
    if (!state.participants.includes(userId)) {
      state.participants.push(userId);
    }
  }

  // Reset if no hostile messages in last 10 min
  if (Date.now() - state.startedAt > 10 * 60 * 1000 && state.hostileCount === 0) {
    state = {
      guildId,
      channelId,
      messageCount: 0,
      hostileCount: 0,
      participants: [],
      startedAt: Date.now(),
      lastUpdated: Date.now(),
      slowmodeActive: false,
    };
  }

  escalationMap.set(key, state);
  return state;
}

export async function checkEscalation(
  guildId: string,
  channelId: string,
  threshold: number
): Promise<{ shouldIntervene: boolean; intensity: number; summary: string; recommendation: string }> {
  const key = `${guildId}:${channelId}`;
  const state = escalationMap.get(key);

  if (!state || state.hostileCount < threshold) {
    return { shouldIntervene: false, intensity: 0, summary: "", recommendation: "" };
  }

  const buffer = messageBuffer.get(key) || [];
  if (buffer.length < 3) {
    return { shouldIntervene: false, intensity: 0, summary: "", recommendation: "" };
  }

  try {
    const result = await analyzeEscalation(buffer);
    return {
      shouldIntervene: result.isEscalating && result.intensity >= 6,
      intensity: result.intensity,
      summary: result.summary,
      recommendation: result.recommendation,
    };
  } catch (err) {
    logger.error(`checkEscalation failed: ${err}`);
    return { shouldIntervene: false, intensity: 0, summary: "", recommendation: "" };
  }
}

export function getChannelMessages(guildId: string, channelId: string): string[] {
  return messageBuffer.get(`${guildId}:${channelId}`) || [];
}

export function resetEscalation(guildId: string, channelId: string): void {
  const key = `${guildId}:${channelId}`;
  escalationMap.delete(key);
  messageBuffer.delete(key);
}

export function setSlowmodeActive(guildId: string, channelId: string, active: boolean): void {
  const key = `${guildId}:${channelId}`;
  const state = escalationMap.get(key);
  if (state) {
    state.slowmodeActive = active;
    escalationMap.set(key, state);
  }
}
