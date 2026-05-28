import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "../utils/logger";
import type { ModerationResult } from "../types";

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genai.getGenerativeModel({ model: "gemini-2.0-flash" });

// ── Core moderation analysis ─────────────────────────────────────────────────

export async function analyzeMessage(
  content: string,
  context: { username: string; recentMessages?: string[]; userHistory?: string }
): Promise<ModerationResult> {
  const contextStr = context.recentMessages?.length
    ? `\nRecent conversation context:\n${context.recentMessages.slice(-5).join("\n")}`
    : "";

  const historyStr = context.userHistory
    ? `\nUser history: ${context.userHistory}`
    : "";

  const prompt = `You are a Discord server moderation AI. Analyze this message for policy violations.

Message from ${context.username}: "${content}"${contextStr}${historyStr}

Analyze for: harassment, hate speech, threats, sexual content, self-harm/crisis, spam, manipulation, bullying, or targeted aggression.

Consider context carefully — sarcasm, jokes, and venting are different from genuine threats or harassment.

Respond ONLY with valid JSON, no markdown, no explanation:
{
  "shouldAct": boolean,
  "action": "ignore" | "warn" | "timeout" | "kick" | "ban" | "alert_mods",
  "severity": "none" | "low" | "medium" | "high" | "critical",
  "categories": string[],
  "confidence": number (0-1),
  "reasoning": string (1 sentence),
  "isCrisis": boolean (true only if self-harm or suicide language detected)
}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean) as ModerationResult;
  } catch (err) {
    logger.error(`analyzeMessage failed: ${err}`);
    return {
      shouldAct: false,
      action: "ignore",
      severity: "none",
      categories: [],
      confidence: 0,
      reasoning: "Analysis failed",
      isCrisis: false,
    };
  }
}

// ── Escalation analysis ──────────────────────────────────────────────────────

export async function analyzeEscalation(messages: string[]): Promise<{
  isEscalating: boolean;
  intensity: number;
  summary: string;
  recommendation: string;
}> {
  const prompt = `Analyze this Discord conversation for signs of escalation, heated argument, or increasing hostility.

Conversation:
${messages.join("\n")}

Respond ONLY with valid JSON:
{
  "isEscalating": boolean,
  "intensity": number (0-10, where 10 is extreme),
  "summary": string (1-2 sentences describing what's happening),
  "recommendation": string (what moderators should do)
}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch (err) {
    logger.error(`analyzeEscalation failed: ${err}`);
    return { isEscalating: false, intensity: 0, summary: "Analysis failed", recommendation: "Manual review recommended" };
  }
}

// ── Incident summarizer ──────────────────────────────────────────────────────

export async function summarizeIncident(messages: string[], timeRange: string): Promise<string> {
  const prompt = `You are a Discord moderation assistant. Summarize this incident for the moderator team.

Time range: ${timeRange}
Messages:
${messages.join("\n")}

Write a concise incident report with:
- What started it
- Key offensive messages (paraphrased, not quoted)
- Who was involved
- How it escalated
- Overall severity

Keep it under 200 words. Be objective and factual.`;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (err) {
    logger.error(`summarizeIncident failed: ${err}`);
    return "Incident summary unavailable.";
  }
}

// ── User risk explanation ────────────────────────────────────────────────────

export async function explainUserRisk(
  username: string,
  profile: { warningCount: number; timeoutCount: number; toxicityScore: number; flaggedMessages: number; notes: string },
  recentOffenses: string[]
): Promise<string> {
  const prompt = `Explain why this Discord user may be a moderation risk, based on their history.

User: ${username}
Warnings: ${profile.warningCount}
Timeouts: ${profile.timeoutCount}
Toxicity score: ${profile.toxicityScore}/100
Flagged messages: ${profile.flaggedMessages}
Notes: ${profile.notes || "none"}
Recent flagged messages: ${recentOffenses.slice(0, 3).join(" | ") || "none"}

Write a brief, factual 2-3 sentence risk assessment for moderators. Be objective, not accusatory.`;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (err) {
    logger.error(`explainUserRisk failed: ${err}`);
    return "Risk assessment unavailable.";
  }
}

// ── Appeal evaluator ─────────────────────────────────────────────────────────

export async function evaluateAppeal(
  username: string,
  appealMessage: string,
  incidentSummary: string
): Promise<string> {
  const prompt = `A Discord user is appealing a moderation action. Evaluate their appeal objectively.

User: ${username}
Their appeal: "${appealMessage}"
Original incident: ${incidentSummary}

Provide a brief, fair assessment (2-3 sentences) covering:
- Whether the appeal shows genuine understanding / remorse
- Whether the original action seems proportionate
- A recommendation for moderators (approve / deny / further review)

Be neutral and fair. Do not make the final decision — that's for moderators.`;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (err) {
    logger.error(`evaluateAppeal failed: ${err}`);
    return "Appeal assessment unavailable.";
  }
}

// ── Channel summary ──────────────────────────────────────────────────────────

export async function summarizeChannel(messages: string[], channelName: string, duration: string): Promise<string> {
  const prompt = `Summarize the recent conversation in Discord channel #${channelName} over the last ${duration}.

Messages:
${messages.join("\n")}

Provide a neutral 3-5 bullet point summary of:
- Main topics discussed
- Any notable drama or conflicts
- Overall tone/mood
- Anything moderators should be aware of`;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (err) {
    logger.error(`summarizeChannel failed: ${err}`);
    return "Channel summary unavailable.";
  }
}

// ── Raid detection ───────────────────────────────────────────────────────────

export async function analyzeRaid(joinData: { username: string; accountAge: number; joinTime: number }[]): Promise<{
  isRaid: boolean;
  confidence: number;
  reasoning: string;
}> {
  const prompt = `Analyze these recent Discord server joins for raid patterns.

Join data (last 10 minutes):
${joinData.map(j => `- ${j.username}, account age: ${j.accountAge} days, joined: ${new Date(j.joinTime).toISOString()}`).join("\n")}

Look for: new accounts joining rapidly, similar usernames, coordinated timing.

Respond ONLY with valid JSON:
{
  "isRaid": boolean,
  "confidence": number (0-1),
  "reasoning": string (1 sentence)
}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch (err) {
    logger.error(`analyzeRaid failed: ${err}`);
    return { isRaid: false, confidence: 0, reasoning: "Analysis failed" };
  }
}
