import "dotenv/config";
import { initDb } from "./services/database";
import {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  REST,
  Routes,
  Events,
  ActivityType,
} from "discord.js";
import { logger } from "./utils/logger";
import messageCreateEvent from "./events/messageCreate";
import guildMemberAddEvent from "./events/guildMemberAdd";
import {
  modexplainCommand,
  summarizeCommand,
  riskreportCommand,
  appealCommand,
  setupCommand,
  reviewAppealsCommand,
} from "./commands/modCommands";
import fs from "fs";

// ── Validate env ──────────────────────────────────────────────────────────────

const required = ["DISCORD_TOKEN", "DISCORD_CLIENT_ID", "GEMINI_API_KEY"];
for (const key of required) {
  if (!process.env[key]) {
    logger.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

// Ensure logs dir
fs.mkdirSync("logs", { recursive: true });

// ── Client setup ──────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.Message, Partials.Channel],
});

// ── Commands registry ─────────────────────────────────────────────────────────

const commands = new Collection<string, any>();
const commandList = [
  modexplainCommand,
  summarizeCommand,
  riskreportCommand,
  appealCommand,
  setupCommand,
  reviewAppealsCommand,
];

for (const cmd of commandList) {
  commands.set(cmd.data.name, cmd);
}

// ── Register slash commands ───────────────────────────────────────────────────

async function registerCommands() {
  const rest = new REST().setToken(process.env.DISCORD_TOKEN!);

  try {
    logger.info("Registering slash commands...");
    await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID!), {
      body: commandList.map(c => c.data.toJSON()),
    });
    logger.info(`Registered ${commandList.length} slash commands`);
  } catch (err) {
    logger.error(`Failed to register commands: ${err}`);
  }
}

// ── Events ────────────────────────────────────────────────────────────────────

client.once(Events.ClientReady, async (c) => {
  logger.info(`✅ Sentinel is online as ${c.user.tag}`);
  logger.info(`Watching ${c.guilds.cache.size} server(s)`);

  c.user.setActivity("your server 👀", { type: ActivityType.Watching });

  await registerCommands();
});

client.on(Events.MessageCreate, (message) => {
  messageCreateEvent.execute(message).catch(err => {
    logger.error(`MessageCreate handler error: ${err}`);
  });
});

client.on(Events.GuildMemberAdd, (member) => {
  guildMemberAddEvent.execute(member).catch(err => {
    logger.error(`GuildMemberAdd handler error: ${err}`);
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    logger.error(`Command ${interaction.commandName} error: ${err}`);
    const reply = { content: "⚠️ An error occurred while running this command.", ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

process.on("SIGINT", () => {
  logger.info("Shutting down...");
  client.destroy();
  process.exit(0);
});

process.on("unhandledRejection", (err) => {
  logger.error(`Unhandled rejection: ${err}`);
});

// ── Launch ────────────────────────────────────────────────────────────────────

initDb().then(() => {
  client.login(process.env.DISCORD_TOKEN).catch(err => {
    logger.error(`Failed to login: ${err}`);
    process.exit(1);
  });
}).catch(err => {
  logger.error(`Failed to initialize database: ${err}`);
  process.exit(1);
});
