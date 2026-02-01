const GUILD_ID = '1467028259668758561RE';

import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

// Put your bot’s APPLICATION (CLIENT) ID here:
const CLIENT_ID = '1467027336686997726';

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID');
  process.exit(1);
}

// Load command definitions from ./commands
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const commandsPath = path.join(__dirname, 'commands');

const commands = [];
for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
    const fullPath = path.join(commandsPath, file);
    const cmd = await import(pathToFileURL(fullPath).href);

  commands.push(cmd.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Deploying ${commands.length} commands…`);
    await rest.put(Routes.applicationCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Commands deployed.');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
