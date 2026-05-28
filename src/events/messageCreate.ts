import { Events, Message, EmbedBuilder, TextChannel, Colors } from "discord.js";
import { analyzeMessage } from "../services/gemini";
import { trackMessage, checkEscalation, setSlowmodeActive } from "../services/escalation";
import {
  getOrCreateProfile,
  incrementWarning,
  logMessage,
  getConfig,
} from "../services/database";
import { createIncident } from "../services/database";
import { logger } from "../utils/logger";
import { randomUUID } from "crypto";

const CRISIS_RESOURCES = `If you're struggling, please reach out:
🆘 **Crisis Text Line:** Text HOME to 741741
☎️ **988 Suicide & Crisis Lifeline:** Call or text 988
🌐 **International:** https://findahelpline.com`;

export default {
  name: Events.MessageCreate,
  async execute(message: Message) {
    if (message.author.bot || !message.guild) return;

    const config = getConfig(message.guild.id);
    if (!config.autoModEnabled) return;

    const content = message.content;
    if (!content || content.length < 2) return;

    const profile = getOrCreateProfile(message.author.id, message.guild.id);

    // Build user history summary for context
    const userHistory = profile.warningCount > 0
      ? `${profile.warningCount} prior warning(s), toxicity score ${Math.round(profile.toxicityScore)}/100`
      : undefined;

    // Analyze the message
    let result;
    try {
      result = await analyzeMessage(content, {
        username: message.author.username,
        userHistory,
      });
    } catch {
      return;
    }

    const isHostile = result.severity !== "none" && result.confidence > 0.5;

    // Log to DB
    logMessage(
      message.guild.id,
      message.channel.id,
      message.author.id,
      content,
      result.confidence * (result.severity === "none" ? 0 : 1),
      result.shouldAct
    );

    // Track escalation
    trackMessage(
      message.guild.id,
      message.channel.id,
      message.author.id,
      message.author.username,
      content,
      isHostile
    );

    // ── Crisis detection ─────────────────────────────────────────────────────
    if (result.isCrisis && config.crisisAlertEnabled) {
      await handleCrisis(message, config);
      return; // Don't also punish someone in crisis
    }

    // ── Take moderation action ────────────────────────────────────────────────
    if (result.shouldAct && result.confidence > 0.65) {
      await takeModerationAction(message, result, config);

      // Update user profile
      const toxicityDelta = { low: 5, medium: 15, high: 25, critical: 40, none: 0 }[result.severity] ?? 0;
      incrementWarning(message.author.id, message.guild.id, toxicityDelta);

      // Log incident
      const incident = {
        id: randomUUID(),
        guildId: message.guild.id,
        channelId: message.channel.id,
        triggeredBy: message.author.id,
        involvedUsers: [message.author.id],
        severity: result.severity,
        categories: result.categories,
        summary: result.reasoning,
        messageSnapshot: content.slice(0, 500),
        actionTaken: result.action,
        resolvedAt: null,
        createdAt: Date.now(),
      };
      createIncident(incident);
    }

    // ── Escalation check ─────────────────────────────────────────────────────
    if (isHostile) {
      const escalation = await checkEscalation(
        message.guild.id,
        message.channel.id,
        config.escalationThreshold
      );

      if (escalation.shouldIntervene) {
        await handleEscalation(message, escalation, config);
      }
    }
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function takeModerationAction(message: Message, result: any, config: any) {
  const guild = message.guild!;
  const member = message.member;

  try {
    switch (result.action) {
      case "warn":
        await message.reply({
          content: `⚠️ **Warning:** Your message violates our community guidelines. Please keep the conversation respectful.`,
          allowedMentions: { repliedUser: true },
        });
        break;

      case "timeout":
        await message.delete().catch(() => {});
        await member?.timeout(10 * 60 * 1000, `AI Mod: ${result.categories.join(", ")}`);
        await (message.channel as TextChannel).send(`🔇 <@${message.author.id}> has been timed out for 10 minutes.`);
        break;

      case "kick":
        await message.delete().catch(() => {});
        await member?.kick(`AI Mod: ${result.categories.join(", ")}`);
        break;

      case "ban":
        await message.delete().catch(() => {});
        await guild.members.ban(message.author.id, { reason: `AI Mod: ${result.categories.join(", ")}` });
        break;

      case "alert_mods":
        await alertMods(message, result, config);
        break;
    }

    // Alert mods for medium+ severity
    if (["high", "critical"].includes(result.severity)) {
      await alertMods(message, result, config);
    }
  } catch (err) {
    logger.error(`takeModerationAction error: ${err}`);
  }
}

async function alertMods(message: Message, result: any, config: any) {
  if (!config.modChannelId) return;

  const modChannel = message.guild?.channels.cache.get(config.modChannelId) as TextChannel | undefined;
  if (!modChannel) return;

  const embed = new EmbedBuilder()
    .setTitle("🚨 Moderation Alert")
    .setColor(result.severity === "critical" ? Colors.Red : Colors.Orange)
    .addFields(
      { name: "User", value: `<@${message.author.id}> (${message.author.tag})`, inline: true },
      { name: "Channel", value: `<#${message.channel.id}>`, inline: true },
      { name: "Severity", value: result.severity.toUpperCase(), inline: true },
      { name: "Categories", value: result.categories.join(", ") || "N/A", inline: true },
      { name: "Confidence", value: `${Math.round(result.confidence * 100)}%`, inline: true },
      { name: "Action Taken", value: result.action, inline: true },
      { name: "AI Reasoning", value: result.reasoning },
      { name: "Message", value: message.content.slice(0, 300) || "(empty)" }
    )
    .setTimestamp()
    .setFooter({ text: `Jump to message` });

  await modChannel.send({ embeds: [embed] });
}

async function handleCrisis(message: Message, config: any) {
  // DM the user privately
  try {
    await message.author.send(
      `Hi ${message.author.username}, I noticed your message and wanted to check in.\n\n${CRISIS_RESOURCES}\n\nYou're not alone. 💙`
    );
  } catch {
    // DMs disabled, send ephemeral-like message
  }

  // Alert mods privately
  if (config.modChannelId) {
    const modChannel = message.guild?.channels.cache.get(config.modChannelId) as TextChannel | undefined;
    if (modChannel) {
      const embed = new EmbedBuilder()
        .setTitle("💙 Crisis Alert — Immediate Attention Needed")
        .setColor(Colors.Blue)
        .addFields(
          { name: "User", value: `<@${message.author.id}> (${message.author.tag})` },
          { name: "Channel", value: `<#${message.channel.id}>` },
          { name: "Message", value: message.content.slice(0, 500) }
        )
        .setDescription("This user may be in distress. Please reach out to them privately and with care.")
        .setTimestamp();

      await modChannel.send({ embeds: [embed] });
    }
  }
}

async function handleEscalation(message: Message, escalation: any, config: any) {
    const channel = message.channel as TextChannel;

    // Apply slowmode
    try {
      await channel.setRateLimitPerUser(30, "Sentinel: Escalation detected");
    setSlowmodeActive(message.guild!.id, message.channel.id, true);

    await channel.send(
      `🌡️ This conversation is getting heated. A 30-second slowmode has been applied. Please take a breath and keep things respectful.`
    );
  } catch (err) {
    logger.error(`handleEscalation slowmode error: ${err}`);
  }

  // Alert mods
  if (config.modChannelId) {
    const modChannel = message.guild?.channels.cache.get(config.modChannelId) as TextChannel | undefined;
    if (modChannel) {
      const embed = new EmbedBuilder()
        .setTitle("📈 Escalation Detected")
        .setColor(Colors.Yellow)
        .addFields(
          { name: "Channel", value: `<#${message.channel.id}>` },
          { name: "Intensity", value: `${escalation.intensity}/10` },
          { name: "Summary", value: escalation.summary },
          { name: "Recommendation", value: escalation.recommendation }
        )
        .setTimestamp();

      await modChannel.send({ embeds: [embed] });
    }
  }
}
