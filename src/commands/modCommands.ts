import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
  PermissionFlagsBits,
  TextChannel,
} from "discord.js";
import {
  explainUserRisk,
  summarizeChannel,
  evaluateAppeal,
} from "../services/gemini";
import {
  getOrCreateProfile,
  getTopRiskUsers,
  getRecentIncidents,
  getUserIncidents,
  getPendingAppeals,
  updateAppealStatus,
  createAppeal,
  setConfig,
  getConfig,
  getRecentMessages,
} from "../services/database";
import { getChannelMessages } from "../services/escalation";
import { logger } from "../utils/logger";
import { randomUUID } from "crypto";

// ── /modexplain ──────────────────────────────────────────────────────────────

export const modexplainCommand = {
  data: new SlashCommandBuilder()
    .setName("modexplain")
    .setDescription("Get an AI risk assessment for a user")
    .addUserOption(opt => opt.setName("user").setDescription("The user to analyze").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const target = interaction.options.getUser("user", true);
    const guildId = interaction.guildId!;
    const profile = getOrCreateProfile(target.id, guildId);
    const incidents = getUserIncidents(target.id, guildId);
    const recentOffenses = incidents.slice(0, 5).map(i => i.summary);

    try {
      const assessment = await explainUserRisk(
        target.username,
        { ...profile, notes: profile.notes || "" },
        recentOffenses
      );

      const embed = new EmbedBuilder()
        .setTitle(`🔍 Risk Assessment: ${target.username}`)
        .setColor(profile.toxicityScore > 50 ? Colors.Red : profile.toxicityScore > 20 ? Colors.Orange : Colors.Green)
        .addFields(
          { name: "Warnings", value: String(profile.warningCount), inline: true },
          { name: "Timeouts", value: String(profile.timeoutCount), inline: true },
          { name: "Toxicity Score", value: `${Math.round(profile.toxicityScore)}/100`, inline: true },
          { name: "Flagged Messages", value: String(profile.flaggedMessages), inline: true },
          { name: "AI Assessment", value: assessment }
        )
        .setThumbnail(target.displayAvatarURL())
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.error(`modexplain error: ${err}`);
      await interaction.editReply("Failed to generate risk assessment.");
    }
  },
};

// ── /summarize ───────────────────────────────────────────────────────────────

export const summarizeCommand = {
  data: new SlashCommandBuilder()
    .setName("summarize")
    .setDescription("AI summary of recent channel activity")
    .addChannelOption(opt => opt.setName("channel").setDescription("Channel to summarize (defaults to current)"))
    .addStringOption(opt =>
      opt.setName("duration")
        .setDescription("Time range to summarize")
        .addChoices(
          { name: "Last 30 minutes", value: "30 minutes" },
          { name: "Last 1 hour", value: "1 hour" },
          { name: "Last 2 hours", value: "2 hours" }
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const channel = (interaction.options.getChannel("channel") as TextChannel | null) ?? interaction.channel as TextChannel;
    const duration = interaction.options.getString("duration") ?? "1 hour";
    const guildId = interaction.guildId!;

    // Get cached message buffer
    const messages = getChannelMessages(guildId, channel.id);

    if (messages.length < 3) {
      await interaction.editReply("Not enough recent messages in buffer to summarize. Messages are buffered in real-time as they come in.");
      return;
    }

    try {
      const summary = await summarizeChannel(messages, channel.name, duration);

      const embed = new EmbedBuilder()
        .setTitle(`📋 Channel Summary: #${channel.name}`)
        .setColor(Colors.Blurple)
        .setDescription(summary)
        .setFooter({ text: `Last ${duration} • ${messages.length} messages analyzed` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.error(`summarize error: ${err}`);
      await interaction.editReply("Failed to generate summary.");
    }
  },
};

// ── /riskreport ──────────────────────────────────────────────────────────────

export const riskreportCommand = {
  data: new SlashCommandBuilder()
    .setName("riskreport")
    .setDescription("Show the top at-risk users in this server")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guildId!;
    const topUsers = getTopRiskUsers(guildId, 10);

    if (topUsers.length === 0) {
      await interaction.editReply("No user data yet. The bot will populate this as it moderates.");
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("⚠️ Risk Report — Top Flagged Users")
      .setColor(Colors.Orange)
      .setTimestamp();

    const lines = topUsers
      .filter(u => u.toxicityScore > 0)
      .map((u, i) => `**${i + 1}.** <@${u.userId}> — Score: ${Math.round(u.toxicityScore)}/100 | Warnings: ${u.warningCount} | Flags: ${u.flaggedMessages}`);

    embed.setDescription(lines.join("\n") || "No flagged users yet.");

    const recentIncidents = getRecentIncidents(guildId, 5);
    if (recentIncidents.length > 0) {
      const incidentLines = recentIncidents.map(i =>
        `• \`${i.severity.toUpperCase()}\` <@${i.triggeredBy}> — ${i.summary.slice(0, 80)}`
      );
      embed.addFields({ name: "Recent Incidents", value: incidentLines.join("\n") });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};

// ── /appeal ──────────────────────────────────────────────────────────────────

export const appealCommand = {
  data: new SlashCommandBuilder()
    .setName("appeal")
    .setDescription("Submit an appeal for a moderation action")
    .addStringOption(opt =>
      opt.setName("message")
        .setDescription("Explain your appeal")
        .setRequired(true)
        .setMaxLength(1000)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const appealMessage = interaction.options.getString("message", true);
    const userId = interaction.user.id;
    const guildId = interaction.guildId!;

    const profile = getOrCreateProfile(userId, guildId);
    const incidents = getUserIncidents(userId, guildId);
    const latestIncident = incidents[0];

    const incidentSummary = latestIncident
      ? `Incident: ${latestIncident.summary}, Action: ${latestIncident.actionTaken}`
      : "No specific incident on record";

    try {
      const aiAssessment = await evaluateAppeal(interaction.user.username, appealMessage, incidentSummary);

      const appeal = {
        id: randomUUID(),
        guildId,
        userId,
        incidentId: latestIncident?.id ?? null,
        message: appealMessage,
        aiAssessment,
        status: "pending" as const,
        reviewedBy: null,
        createdAt: Date.now(),
      };

      createAppeal(appeal);

      await interaction.editReply(
        `✅ Your appeal has been submitted and reviewed by our AI assistant. A moderator will make the final decision.\n\n**AI Assessment:**\n${aiAssessment}`
      );

      // Notify mods
      const config = getConfig(guildId);
      if (config.modChannelId) {
        const modChannel = interaction.guild?.channels.cache.get(config.modChannelId) as TextChannel | undefined;
        if (modChannel) {
          const embed = new EmbedBuilder()
            .setTitle("📬 New Appeal Submitted")
            .setColor(Colors.Blurple)
            .addFields(
              { name: "User", value: `<@${userId}>` },
              { name: "Appeal", value: appealMessage },
              { name: "AI Assessment", value: aiAssessment },
              { name: "Appeal ID", value: appeal.id }
            )
            .setTimestamp();

          await modChannel.send({ embeds: [embed] });
        }
      }
    } catch (err) {
      logger.error(`appeal error: ${err}`);
      await interaction.editReply("Failed to submit appeal. Please try again.");
    }
  },
};

// ── /setup ───────────────────────────────────────────────────────────────────

export const setupCommand = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure Sentinel for this server")
    .addChannelOption(opt => opt.setName("mod_channel").setDescription("Channel for mod alerts").setRequired(true))
    .addChannelOption(opt => opt.setName("log_channel").setDescription("Channel for audit logs"))
    .addBooleanOption(opt => opt.setName("auto_mod").setDescription("Enable automatic moderation (default: true)"))
    .addBooleanOption(opt => opt.setName("raid_protection").setDescription("Enable raid detection (default: true)"))
    .addBooleanOption(opt => opt.setName("crisis_alerts").setDescription("Enable crisis/mental health detection (default: true)"))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const modChannel = interaction.options.getChannel("mod_channel", true) as TextChannel;
    const logChannel = interaction.options.getChannel("log_channel") as TextChannel | null;
    const autoMod = interaction.options.getBoolean("auto_mod") ?? true;
    const raidProtection = interaction.options.getBoolean("raid_protection") ?? true;
    const crisisAlerts = interaction.options.getBoolean("crisis_alerts") ?? true;

    setConfig(interaction.guildId!, {
      modChannelId: modChannel.id,
      logChannelId: logChannel?.id ?? null,
      autoModEnabled: autoMod,
      raidProtectionEnabled: raidProtection,
      crisisAlertEnabled: crisisAlerts,
    });

    const embed = new EmbedBuilder()
      .setTitle("✅ Sentinel Configured")
      .setColor(Colors.Green)
      .addFields(
        { name: "Mod Channel", value: `<#${modChannel.id}>`, inline: true },
        { name: "Log Channel", value: logChannel ? `<#${logChannel.id}>` : "Not set", inline: true },
        { name: "Auto Mod", value: autoMod ? "✅ Enabled" : "❌ Disabled", inline: true },
        { name: "Raid Protection", value: raidProtection ? "✅ Enabled" : "❌ Disabled", inline: true },
        { name: "Crisis Alerts", value: crisisAlerts ? "✅ Enabled" : "❌ Disabled", inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

// ── /appeals (mod review) ─────────────────────────────────────────────────────

export const reviewAppealsCommand = {
  data: new SlashCommandBuilder()
    .setName("appeals")
    .setDescription("Review pending user appeals")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const pending = getPendingAppeals(interaction.guildId!);

    if (pending.length === 0) {
      await interaction.editReply("✅ No pending appeals.");
      return;
    }

    const lines = pending.map((a, i) =>
      `**${i + 1}.** <@${a.userId}> — \`ID: ${a.id.slice(0, 8)}\`\n> ${a.message.slice(0, 100)}\n> 🤖 ${a.aiAssessment.slice(0, 100)}`
    );

    const embed = new EmbedBuilder()
      .setTitle(`📬 Pending Appeals (${pending.length})`)
      .setColor(Colors.Blurple)
      .setDescription(lines.join("\n\n"))
      .setFooter({ text: "Use /approveappeal or /denyappeal <id> to resolve" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
