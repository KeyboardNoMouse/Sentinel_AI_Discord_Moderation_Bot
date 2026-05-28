export interface ModerationResult {
  shouldAct: boolean;
  action: "ignore" | "warn" | "timeout" | "kick" | "ban" | "alert_mods";
  severity: "none" | "low" | "medium" | "high" | "critical";
  categories: string[];
  confidence: number;
  reasoning: string;
  isCrisis: boolean;
}

export interface EscalationState {
  guildId: string;
  channelId: string;
  messageCount: number;
  hostileCount: number;
  participants: string[];
  startedAt: number;
  lastUpdated: number;
  slowmodeActive: boolean;
}

export interface UserProfile {
  userId: string;
  guildId: string;
  warningCount: number;
  timeoutCount: number;
  toxicityScore: number;
  lastOffenseAt: number | null;
  flaggedMessages: number;
  joinedAt: number;
  notes: string;
}

export interface Incident {
  id: string;
  guildId: string;
  channelId: string;
  triggeredBy: string;
  involvedUsers: string[];
  severity: string;
  categories: string[];
  summary: string;
  messageSnapshot: string;
  actionTaken: string;
  resolvedAt: number | null;
  createdAt: number;
}

export interface Appeal {
  id: string;
  guildId: string;
  userId: string;
  incidentId: string | null;
  message: string;
  aiAssessment: string;
  status: "pending" | "approved" | "denied";
  reviewedBy: string | null;
  createdAt: number;
}

export interface BotConfig {
  guildId: string;
  modChannelId: string | null;
  logChannelId: string | null;
  autoModEnabled: boolean;
  escalationThreshold: number;
  crisisAlertEnabled: boolean;
  raidProtectionEnabled: boolean;
}
