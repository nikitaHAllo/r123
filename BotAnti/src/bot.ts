import { Bot } from 'grammy';
import { BOT_TOKEN, ADMINS } from './config.js';
import { initDB, getWords, loadSettingsFromDB } from './db.js';
import { updateCustom } from './filters.js';
import { registerAdminPanel, initAdminDB } from './admin.js';
import { registerCommands } from './handlers/commands.js';
import { registerCallbacks } from './handlers/callbacks.js';
import { registerMessageHandlers } from './handlers/messageHandler.js';
import { MessageData } from './handlers/documentHandler.js';

async function main() {
	await initDB();
	await loadSettingsFromDB();
	await initAdminDB();

	console.log('ADMINS:', ADMINS);
	updateCustom(await getWords('custom_words'));

	const bot = new Bot(BOT_TOKEN);
	registerAdminPanel(bot);

	const allMessages: MessageData[] = [];
	const totalFilesProcessed = { value: 0 };

	registerCommands(bot, allMessages, totalFilesProcessed);
	registerCallbacks(bot, totalFilesProcessed, () => {
		allMessages.length = 0;
		totalFilesProcessed.value = 0;
	});
	registerMessageHandlers(bot, allMessages, totalFilesProcessed);

	bot.catch(err => {
		console.error('Ошибка бота:', err);
	});

	bot.start();
	console.log('Бот запущен 🚀');
}

main().catch(err => console.error('Ошибка в боте:', err));
