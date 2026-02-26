/**
 * Точка входа режима Bot (Grammy).
 */
import { Bot } from 'grammy';
import { BOT_TOKEN, ADMINS } from '../../config.js';
import { initDB, loadSettingsFromDB } from '../../db.js';
import { updateCustom } from '../../filters.js';
import { getWords } from '../../db.js';
import { registerAdminPanel, initAdminDB } from '../common/adminPanel.js';
import { registerCommands } from '../../handlers/commands.js';
import { registerCallbacks } from '../../handlers/callbacks.js';
import { registerMessageHandlers } from '../../handlers/messageHandler.js';
import type { MessageData } from '../../handlers/documentHandler.js';

const allMessages: MessageData[] = [];
const totalFilesProcessed = { value: 0 };

export async function startBot(): Promise<void> {
	await initDB();
	await loadSettingsFromDB();
	await initAdminDB();

	updateCustom(await getWords('custom_words'));
	console.log('ADMINS:', ADMINS);

	const bot = new Bot(BOT_TOKEN);
	registerAdminPanel(bot);

	registerCommands(bot, allMessages, totalFilesProcessed);
	registerCallbacks(bot, totalFilesProcessed, () => {
		allMessages.length = 0;
		totalFilesProcessed.value = 0;
	});
	registerMessageHandlers(bot, allMessages, totalFilesProcessed);

	bot.catch((err) => {
		console.error('Ошибка бота:', err);
	});

	await bot.start();
	console.log('Бот запущен 🚀');
}
