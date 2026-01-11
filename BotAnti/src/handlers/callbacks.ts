import { Bot } from 'grammy';
import {
	activeAnalyses,
	pendingMessages,
	startAnalysis,
	createLimitKeyboard,
} from './messageAnalysis.js';

export const waitingForCustomLimit = new Map<number, boolean>();
export const waitingForAuthorFilter = new Map<number, boolean>();

const CALLBACK_PREFIXES = {
	CANCEL: 'cancel_',
	ANALYZE_LIMIT: 'analyze_limit_',
	ANALYZE_AUTHOR_FILTER: 'analyze_author_filter_',
} as const;

function handleCancelCallback(ctx: any, chatId: number) {
	const analysis = activeAnalyses.get(chatId);
	if (analysis && !analysis.cancel) {
		analysis.cancel = true;
		analysis.controller?.abort();
		return ctx.answerCallbackQuery({ text: '⏹ Анализ остановлен.' });
	}
	return ctx.answerCallbackQuery({
		text: '⚠️ Анализ не выполняется.',
		show_alert: false,
	});
}

function parseLimitCallback(
	data: string
): { chatId: number; limitStr: string } | null {
	const match = data.match(/^analyze_limit_(\d+)_(.+)$/);
	if (!match) return null;
	return {
		chatId: Number(match[1]),
		limitStr: match[2],
	};
}

function parseLimit(limitStr: string, maxLimit: number): number | null {
	if (limitStr === 'all') return null;
	const limit = Number.parseInt(limitStr, 10);
	if (isNaN(limit) || limit < 1) return -1;
	return Math.min(limit, maxLimit);
}

export function registerCallbacks(
	bot: Bot,
	totalFilesProcessed: { value: number },
	onAnalysisComplete?: () => void
) {
	bot.on('callback_query:data', async ctx => {
		const data = ctx.callbackQuery?.data;
		if (!data) return;

		if (data.startsWith(CALLBACK_PREFIXES.CANCEL)) {
			const chatId = Number(data.split('_')[1]);
			await handleCancelCallback(ctx, chatId);
			return;
		}

		if (data.startsWith(CALLBACK_PREFIXES.ANALYZE_AUTHOR_FILTER)) {
			const chatId = Number(data.split('_').pop());
			const pending = pendingMessages.get(chatId);
			if (!pending) {
				await ctx.answerCallbackQuery({
					text: '⚠️ Данные о файле не найдены. Загрузите файл заново.',
					show_alert: true,
				});
				return;
			}

			await ctx.answerCallbackQuery();
			waitingForAuthorFilter.set(chatId, true);

			const currentFilter = pending.authorFilter
				? `\n\nТекущий фильтр: "${pending.authorFilter}"\nДля сброса отправьте "clear"`
				: '';

			// Показываем количество сообщений с текущим фильтром
			const filteredCount = pending.authorFilter
				? (() => {
						const filter = pending.authorFilter!;
						const isNumeric = /^\d+$/.test(filter.trim());
						return pending.messages.filter(msg => {
							if (isNumeric) {
								return msg.userId && String(msg.userId) === filter.trim();
							} else {
								return msg.author.toLowerCase().includes(filter.toLowerCase());
							}
						}).length;
				  })()
				: pending.messages.length;

			const keyboard = createLimitKeyboard(chatId, pending.authorFilter);

			await ctx.editMessageText(
				`👤 Введите имя автора или user_id для поиска сообщений:${currentFilter}\n\n` +
				`Примеры:\n` +
				`• По имени: Никита\n` +
				`• По user_id: 123456789\n\n` +
				`Будут проверены только сообщения от авторов, чье имя содержит указанное или user_id совпадает.\n\n` +
				`📊 Всего сообщений: ${pending.messages.length}\n` +
				`📊 Сообщений с текущим фильтром: ${filteredCount}`,
				{
					reply_markup: keyboard,
				}
			);
			return;
		}

		if (data.startsWith(CALLBACK_PREFIXES.ANALYZE_LIMIT)) {
			const parsed = parseLimitCallback(data);
			if (!parsed) {
				await ctx.answerCallbackQuery({
					text: '❌ Ошибка формата callback',
					show_alert: true,
				});
				return;
			}

			const { chatId, limitStr } = parsed;
			const pending = pendingMessages.get(chatId);
			if (!pending) {
				await ctx.answerCallbackQuery({
					text: '⚠️ Данные о файле не найдены. Загрузите файл заново.',
					show_alert: true,
				});
				return;
			}

			await ctx.answerCallbackQuery();

			if (limitStr === 'custom') {
				waitingForCustomLimit.set(chatId, true);
				await ctx.editMessageText(
					`✏️ Введите количество сообщений для анализа (от 1 до ${pending.messages.length}):`
				);
				return;
			}

			const limit = parseLimit(limitStr, pending.messages.length);
			if (limit === -1) {
				await ctx.reply('❌ Некорректное количество сообщений.');
				return;
			}

			const authorFilter = pending.authorFilter;
			pendingMessages.delete(chatId);
			await ctx.editMessageText('✅ Начинаю анализ...');
			await startAnalysis(
				ctx,
				bot,
				chatId,
				pending.messages,
				pending.fileName,
				limit,
				totalFilesProcessed.value,
				onAnalysisComplete,
				authorFilter
			);
		}
	});
}
