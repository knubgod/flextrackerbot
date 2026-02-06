# Flex Tracker – User Flow

Flex Tracker is a self-hosted Discord bot designed for small private groups of
League of Legends players.

## Intended Use

- Private Discord servers
- Non-commercial
- Small rosters (friends / teammates)
- Conservative API usage

## Typical User Flow

1. Server owner creates a Discord application and bot.
2. Bot is invited to a Discord server with slash command permissions.
3. Server admins configure:
   - Alert channel
   - Roster (Riot IDs)
   - Detection threshold
4. The bot periodically checks whether roster members are playing
   Ranked Flex (queue ID 440).
5. When 3 or more roster members are detected on the same team:
   - The match is tracked
6. After the match finishes:
   - The bot posts a summary embed in Discord showing:
     - Win or loss
     - Champion played
     - K/D/A
     - Match ID
     - External profile links (OP.GG)
7. The bot stores match results locally and maintains a team record.

## API Usage

- Riot Spectator API (active games)
- Riot Match API (completed matches)
- Riot Account API (PUUID resolution)
- Poll interval defaults to 60 seconds
- Results are cached locally to minimize requests