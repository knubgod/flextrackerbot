# Changelog

All notable changes to this project will be documented in this file.

This project follows semantic versioning.

---

## [1.2.0] - 2026-02-XX

### Added
- `/stats` command
- Blue side vs Red side win rate tracking
- 5-stack specific record tracking
- Enemy champion win rate tracking
- Graceful "Not enough data yet" handling

### Database
- Added `side` column to `stack_matches`
- Added `enemy_champ_results` table
- Added database migration system

### Improvements
- Improved command context stability (`ctx.db`)
- Improved DDragon version fallback
- Improved polling status tracking

---

## [1.1.0]

### Added
- Manual record adjustments
- Roster slash command management
- Guild configuration system

---

## [1.0.0]

### Initial Release
- Flex stack detection (Ranked Flex 440)
- Match completion tracking
- Auto win/loss record
- Discord embed match summaries