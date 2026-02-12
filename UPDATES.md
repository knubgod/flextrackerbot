# Flex Tracker Bot — Update Instructions

The Flex Tracker Bot is a self-hosted Discord bot.  
These instructions walk you through updating your bot to the latest released version.

> These steps assume you originally installed the bot using Git and Node.js.

---

## Before You Begin

- Make sure the bot is **fully stopped** before updating.
- Open your terminal or command prompt.
- Navigate to your Flex Tracker Bot project folder.

If you are unsure what directory you are in:

```bash
pwd
```

Or on Windows:

```bash
cd
```

Then navigate to your bot folder:

```bash
cd path/to/flex-tracker-bot
```

---

## Updating the Flex Tracker Bot

### 1. Pull the Latest Version from GitHub

Inside the bot folder, run:

```bash
git pull origin main
```

If your repository uses `master` instead:

```bash
git pull origin master
```

This downloads the latest updates and improvements.

---

### 2. Update Dependencies

Even if nothing major changed, always run:

```bash
npm install
```

This ensures all required packages are installed and up to date with the newest version.

---

### 3. Restart the Bot

If you start the bot manually:

```bash
node index.js
```

If you use PM2:

```bash
pm2 restart flex-tracker
```

(Replace the process name if you named it something different.)

---

## Confirm the Update

After restarting:

- Check the terminal for errors
- Confirm the bot shows as online in Discord
- Test a basic command to verify functionality

If everything runs without errors, your update is complete.

---

## Important Notes

- There are currently **no expected `.env` changes** between versions.
- Do **not** delete your existing `.env` file.
- If future updates require new environment variables, it will be clearly documented in the release notes.

---

## Need Help?

If you encounter bugs, have feature requests, or need clarification:

Please open an issue directly on the Flex Tracker Bot GitHub repository.

Include:
- Your Node.js version
- Your operating system
- The full error message (if applicable)
- Steps to reproduce the issue

This helps diagnose problems quickly and keeps support organized.

---

You are now running the latest version of Flex Tracker Bot.