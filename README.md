# Clash Tracker Discord Bot (Ranked Flex Stack Alerts)

A Discord bot that monitors a roster of League of Legends players and posts alerts when **3+ roster players** are detected **stacked together on the same team in Ranked Flex (queue 440)**. It also tracks a stacked Flex **win/loss record** and supports **manual adjustments** for games played while the bot was offline.

---

## Features

- Detects **Ranked Flex (440)** games with **N+ roster players** on the same team (default threshold: 3).
- Posts to a configurable Discord channel:
  - **“Flex stack detected”** (when found in-progress)
  - **“Flex stack finished: WIN/LOSS”** (after the match ends)
- Tracks records in SQLite:
  - **Auto record**: matches detected by the bot
  - **Manual record**: adjustments via commands
  - **Total record**: auto + manual
- Roster management via slash commands (no code edits required).
- Server configuration via slash commands (no code edits required):
  - alert channel
  - threshold
  - polling interval

---

## Requirements

- Node.js **20+** recommended (works with newer versions too)
- A Discord application + bot token
- A Riot API key (Riot Developer Portal)
- Discord server permissions to invite the bot (Manage Server recommended)

---

### 🚀 Getting Started
Prerequisites

Before running Flex Tracker, you will need:

Node.js 20+

npm

A Discord bot application

A Riot Games API key

A Discord server where you have admin permissions

Flex Tracker is designed to be self-hosted. Each user or server owner runs their own instance.

Installation
1. Clone the repository
git clone https://github.com/knubgod/flextrackerbot.git
cd flextrackerbot

2. Install dependencies
npm install

Configuration
3. Create a .env file

Create a .env file in the project root:

DISCORD_TOKEN=your_discord_bot_token
RIOT_API_KEY=your_riot_api_key
OWNER_USER_ID=your_discord_user_id


⚠️ Never commit your .env file. It is intentionally ignored by Git.

4. (Optional) Local roster seeding

For convenience, server owners may optionally create a local file named:

roster.local.json


Example:

[
  { "gameName": "PlayerOne", "tagLine": "NA1" },
  { "gameName": "PlayerTwo", "tagLine": "NA1" }
]


This file is not required

It is not tracked by Git

It allows the bot to auto-load a roster on startup

Rosters can always be managed later via Discord commands

Running the bot
5. Start the bot
node index.js


For production use, a process manager such as PM2 is recommended:

pm2 start index.js --name flex-tracker
pm2 save

# Discord Setup

Invite the bot to your server with:

applications.commands

bot permissions

Use slash commands to configure the bot:

Set alert channel

Add/remove roster members

View records and status

Once configured, the bot will automatically:

Detect Ranked Flex stacks

Track matches

Post results when games finish

🔐 Responsible API Usage

Flex Tracker is designed with Riot Games API policies and rate limits in mind.

# API Usage Overview

Flex Tracker uses the following Riot APIs:

Spectator API – to detect active Ranked Flex games

Match API – to retrieve completed match data

Account API – to resolve Riot IDs to PUUIDs

No other Riot APIs are used.

# Rate Limiting & Polling

The bot polls at a configurable interval (default: 60 seconds)

Polling frequency is intentionally conservative to avoid rate limit abuse

API calls are limited to roster members only

The bot does not scan arbitrary players or public match histories

Data Handling & Privacy

No personal data is collected beyond publicly available match statistics

All data is stored locally in a SQLite database owned by the server operator

No data is transmitted to third parties

No analytics, tracking, or monetization is performed

Scope & Intended Use

Flex Tracker is intended for:

Small groups

Friend teams

Amateur Ranked Flex players

Private Discord servers

The bot:

❌ Does not provide coaching advice

❌ Does not automate gameplay

❌ Does not perform matchmaking manipulation

❌ Does not support betting or gambling

❌ Does not scrape or resell data

##### Compliance Statement

Flex Tracker is a non-commercial, community-built tool and is not affiliated with or endorsed by Riot Games. All Riot Games trademarks and assets are the property of Riot Games, Inc.