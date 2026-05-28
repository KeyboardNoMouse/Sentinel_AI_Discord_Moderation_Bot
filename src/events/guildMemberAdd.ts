import { Events, GuildMember, EmbedBuilder, TextChannel, Colors } from "discord.js";
import { trackJoin, checkRaid } from "../services/raidDetection";
import { getOrCreateProfile, getConfig } from "../services/database";
import { logger } from "../utils/logger";

export default {
  name: Events.GuildMemberAdd,
  async execute(member: GuildMember) {
    // Track the join for raid detection
    const accountCreatedAt = member.user.createdAt;
    trackJoin(member.guild.id, member.id, member.user.username, accountCreatedAt);

    // Create user profile
    getOrCreateProfile(member.id, member.guild.id);

    const config = getConfig(member.guild.id);
    if (!config.raidProtectionEnabled) return;

    // Check for raid
    try {
      const raidCheck = await checkRaid(member.guild.id);

      if (raidCheck.isRaid && raidCheck.confidence > 0.7 && config.modChannelId) {
        const modChannel = member.guild.channels.cache.get(config.modChannelId) as TextChannel | undefined;
        if (!modChannel) return;

        const embed = new EmbedBuilder()
          .setTitle("🚨 Potential Raid Detected")
          .setColor(Colors.Red)
          .addFields(
            { name: "Recent Joins (10 min)", value: String(raidCheck.joinCount), inline: true },
            { name: "Confidence", value: `${Math.round(raidCheck.confidence * 100)}%`, inline: true },
            { name: "Analysis", value: raidCheck.reasoning }
          )
          .setDescription("Consider enabling server lockdown or screening mode.")
          .setTimestamp();

        await modChannel.send({ embeds: [embed] });
      }
    } catch (err) {
      logger.error(`GuildMemberAdd raid check error: ${err}`);
    }
  },
};
