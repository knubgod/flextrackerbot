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

## Setup (Local Development)

### 1) Install dependencies

From the project folder:

```bash
npm install
