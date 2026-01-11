import { Bot } from 'grammy';
import { ADMINS } from '../config.js';
import { checkBotPermissions } from './violationHandler.js';
import { createLimitKeyboard, pendingMessages } from './messageAnalysis.js';
import { MessageData } from './documentHandler.js';

let isCheckingChat = false;

export function getIsCheckingChat(): boolean {
	return isCheckingChat;
}

export function setIsCheckingChat(value: boolean): void {
	isCheckingChat = value;
}

function isAdmin(ctx: any): boolean {
	return ctx.from && ADMINS.includes(ctx.from.id);
}

export function registerCommands(
	bot: Bot,
	allMessages: MessageData[],
	totalFilesProcessed: { value: number }
) {
	bot.command('check_chat', async ctx => {
		if (!isAdmin(ctx)) return ctx.reply('❌ У тебя нет доступа к этой команде');
		isCheckingChat = true;
		await ctx.reply(
			'✅ Бот готов анализировать все сообщения, которые ты пришлёшь в ЛС.'
		);
	});

	bot.command('stop_check_chat', async ctx => {
		if (!isAdmin(ctx)) return ctx.reply('❌ У тебя нет доступа к этой команде');
		isCheckingChat = false;
		await ctx.reply('🛑 Режим анализа отключён.');
	});

	bot.command('check_permissions', async ctx => {
		if (!isAdmin(ctx)) return ctx.reply('❌ У тебя нет доступа к этой команде');
		if (ctx.chat.type === 'private')
			return ctx.reply('ℹ️ Эта команда работает только в группах и каналах');

		const hasPermissions = await checkBotPermissions(bot, ctx.chat.id);
		if (hasPermissions)
			await ctx.reply('✅ Бот имеет необходимые права администратора');
		else
			await ctx.reply(
				'❌ Бот не имеет прав администратора или прав недостаточно. Требуются права на удаление сообщений.'
			);
	});

	bot.command('analyze', async ctx => {
		if (allMessages.length === 0) {
			await ctx.reply('📭 Нет сообщений для анализа. Сначала загрузите файлы.');
			return;
		}

		const chatId = ctx.chat.id;
		const pending = pendingMessages.get(chatId);
		const authorFilter = pending?.authorFilter;
		const limitKeyboard = createLimitKeyboard(chatId, authorFilter);
		const filterInfo = authorFilter
			? `\n👤 Фильтр по автору: "${authorFilter}"`
			: '';

		await ctx.reply(
			`📊 Готов к анализу!\n` +
				`📁 Обработано файлов: ${totalFilesProcessed.value}\n` +
				`📨 Всего сообщений: ${allMessages.length}${filterInfo}\n\n` +
				`Выберите, сколько сообщений анализировать:`,
			{
				reply_markup: limitKeyboard,
			}
		);

		pendingMessages.set(chatId, {
			messages: allMessages,
			fileName: `все_файлы_(${totalFilesProcessed.value})`,
			authorFilter: pending?.authorFilter, // Сохраняем фильтр если он был установлен
		});
	});

	bot.command('filter_author', async ctx => {
		if (!isAdmin(ctx)) return ctx.reply('❌ У тебя нет доступа к этой команде');

		const args = ctx.message?.text?.split(' ').slice(1);
		if (!args || args.length === 0) {
			const chatId = ctx.chat.id;
			const pending = pendingMessages.get(chatId);
			if (pending?.authorFilter) {
				await ctx.reply(
					`👤 Текущий фильтр по автору: "${pending.authorFilter}"\n\n` +
						`Для сброса фильтра используйте: /filter_author clear\n` +
						`Для установки нового фильтра: /filter_author <имя>`
				);
			} else {
				await ctx.reply(
					`👤 Фильтр по автору не установлен.\n\n` +
					`Использование: /filter_author <имя или user_id>\n` +
					`Примеры:\n` +
					`• /filter_author Никита (по имени)\n` +
					`• /filter_author 123456789 (по user_id)\n\n` +
					`После установки фильтра используйте /analyze для начала анализа.`
				);
			}
			return;
		}

		const authorName = args.join(' ');
		const chatId = ctx.chat.id;

		if (authorName.toLowerCase() === 'clear') {
			const pending = pendingMessages.get(chatId);
			if (pending) {
				delete pending.authorFilter;
				await ctx.reply('✅ Фильтр по автору сброшен.');
			} else {
				await ctx.reply('ℹ️ Фильтр по автору не был установлен.');
			}
			return;
		}

		// Устанавливаем или обновляем фильтр
		const pending = pendingMessages.get(chatId);
		if (pending) {
			pending.authorFilter = authorName;
		} else {
			// Если нет pending, создаем временный для хранения фильтра
			pendingMessages.set(chatId, {
				messages: allMessages,
				fileName: 'ожидание_файла',
				authorFilter: authorName,
			});
		}

		// Проверяем, сколько сообщений соответствует фильтру
		const isNumeric = /^\d+$/.test(authorName.trim());
		const filteredCount = allMessages.filter(msg => {
			if (isNumeric) {
				// Фильтр по user_id
				return msg.userId && String(msg.userId) === authorName.trim();
			} else {
				// Фильтр по имени
				return msg.author.toLowerCase().includes(authorName.toLowerCase());
			}
		}).length;

		const filterType = isNumeric ? 'user_id' : 'имени';
		await ctx.reply(
			`✅ Фильтр по ${filterType} установлен: "${authorName}"\n\n` +
			`📊 Найдено сообщений: ${filteredCount} из ${allMessages.length}\n\n` +
			`Используйте /analyze для начала анализа с этим фильтром.`
		);
	});
}
