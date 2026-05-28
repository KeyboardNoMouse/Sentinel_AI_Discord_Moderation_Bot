# 🛡️ Sentinel — AI Discord Moderation Bot

An intelligent Discord moderation bot powered by **Gemini AI** and built with **TypeScript + discord.js v14**.

Sentinel doesn't just check for banned words — it understands context, intent, harassment patterns, escalation, and can detect crises before they spiral.

---

## Features

| Feature | Description |
|---|---|
| 🧠 Context-aware toxicity detection | Gemini analyzes message intent, not just keywords |
| 📈 Escalation detection | Tracks conversation heat and applies slowmode automatically |
| 💙 Crisis detection | Detects self-harm/distress language and privately alerts mods |
| 🚨 Raid protection | Detects coordinated join patterns using AI |
| 📋 Incident summarizer | Auto-logs moderation incidents with AI summaries |
| 🎯 Smart action system | Warns, times out, kicks, or bans based on severity |
| 📬 Appeals system | Users can appeal; AI pre-evaluates before mods review |
| 🔍 /modexplain | Get a full AI risk assessment on any user |
| 📊 /riskreport | Top at-risk users with toxicity scores |
| 🗂️ /summarize | AI summary of any channel's recent activity |

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in:
- `DISCORD_TOKEN` — from [Discord Developer Portal](https://discord.com/developers/applications)
- `DISCORD_CLIENT_ID` — your app's Application ID
- `GEMINI_API_KEY` — from [Google AI Studio](https://aistudio.google.com)

### 3. Bot permissions

In the Discord Developer Portal, enable these **Privileged Gateway Intents**:
- ✅ Server Members Intent
- ✅ Message Content Intent

Bot requires these **permissions** in your server:
- Manage Messages, Timeout Members, Kick Members, Ban Members
- Send Messages, Read Message History, View Channels

### 4. Build and run

```bash
npm run build
npm start
```

Or for development with hot reload:

```bash
npm run dev
```

---

## Slash Commands

| Command | Permission | Description |
|---|---|---|
| `/setup` | Administrator | Configure mod channel, log channel, and features |
| `/modexplain @user` | Moderator | AI risk assessment for a user |
| `/summarize [channel] [duration]` | Moderator | AI summary of channel activity |
| `/riskreport` | Moderator | Top flagged users in the server |
| `/appeal <message>` | Everyone | Submit an appeal for a moderation action |
| `/appeals` | Moderator | Review pending appeals |

---

## How it works

1. **Every message** is analyzed by Gemini for toxicity, severity, and intent
2. Messages are scored and logged; user toxicity profiles are updated
3. Hostile messages trigger escalation tracking — if a channel heats up, slowmode activates
4. High-severity messages alert moderators via the configured mod channel
5. Users in distress trigger private crisis alerts to mods only
6. Join events are monitored for raid patterns

---

## Project structure

```
src/
├── index.ts              # Entry point, client setup
├── types/index.ts        # TypeScript interfaces
├── events/
│   ├── messageCreate.ts  # Core message handler
│   └── guildMemberAdd.ts # Join/raid detection
├── services/
│   ├── database.ts       # SQLite (better-sqlite3)
│   ├── gemini.ts         # All Gemini AI calls
│   ├── escalation.ts     # Per-channel escalation tracker
│   └── raidDetection.ts  # Join pattern analysis
├── commands/
│   └── modCommands.ts    # All slash commands
└── utils/
    └── logger.ts         # Winston logger
```

---

## Tech stack

- **Runtime:** Node.js + TypeScript
- **Discord:** discord.js v14
- **AI:** Google Gemini 2.0 Flash
- **Database:** SQLite via better-sqlite3 (zero config, local file)
- **Logging:** Winston
