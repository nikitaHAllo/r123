import type { TelegramClient } from 'telegram';
import { LOG_CHAT_IDS, BOT_USERNAME } from '../config.js';
import { DELETE_MESSAGES } from '../state.js';
import { dbPromise } from '../db.js';

const VIOLATION_REASONS: Record<string, string> = {
	violation_profanity: 'ненормативная лексика',
	violation_ad: 'реклама',
	violation_custom: 'запрещенные слова',
	neural_bad_words: 'нежелательный контент (нейросеть)',
	neural_cars: 'автомобильная тема (нейросеть)',
	neural_advertising: 'реклама (нейросеть)',
};

export function getViolationReason(type: string | null): string {
	if (!type) return 'нарушение правил';
	return VIOLATION_REASONS[type] || 'нарушение правил';
}

async function logViolation(
	client: TelegramClient,
	chatId: string | number,
	userId: string | number,
	violationType: string,
	text: string,
	messageId: number,
	chatTitle: string | undefined,
	userName: string
) {
	const msg = `🚨 Нарушение!\n📌 Чат: ${chatId} (${chatTitle || '—'})\n👤 Пользователь: ${userName} (${userId})\nТип: ${violationType}\nТекст: ${text}`;

	for (const dest of LOG_CHAT_IDS) {
		try {
			const entity = dest.toLowerCase() === 'me' ? 'me' : dest;
			await client.sendMessage(entity, { message: msg });
			await client.forwardMessages(entity, {
				messages: [messageId],
				fromPeer: chatId,
			});
		} catch (err) {
			console.error(`Ошибка логирования нарушения (получатель ${dest}):`, err);
		}
	}

	// Дублируем в личку с ботом — тогда отчёты видны в чате с ботом
	if (BOT_USERNAME) {
		try {
			await client.sendMessage(`@${BOT_USERNAME}`, { message: msg });
			await client.forwardMessages(`@${BOT_USERNAME}`, {
				messages: [messageId],
				fromPeer: chatId,
			});
		} catch (err) {
			console.error('Ошибка отправки отчёта боту:', err);
		}
	}
}

export async function handleViolationUserbot(
	client: TelegramClient,
	chatId: string | number,
	messageId: number,
	userId: string | number,
	userName: string,
	text: string,
	violationType: string,
	chatTitle?: string,
	isPrivate?: boolean
): Promise<void> {
	const db = await dbPromise;
	await db.run('INSERT INTO statistics (type,timestamp) VALUES (?,?)', [
		violationType,
		Math.floor(Date.now() / 1000),
	]);

	await logViolation(
		client,
		chatId,
		userId,
		violationType,
		text,
		messageId,
		chatTitle,
		userName
	);

	try {
		if (isPrivate) {
			await client.sendMessage(chatId, {
				message: `❌ Ваше сообщение содержит запрещённый контент. Причина: ${getViolationReason(violationType)}`,
			});
			return;
		}
		if (DELETE_MESSAGES) {
			await client.deleteMessages(chatId, [messageId], { revoke: true });
			const warning = await client.sendMessage(chatId, {
				message: `⚠️ Сообщение от ${userName} удалено.\nПричина: ${getViolationReason(violationType)}`,
			});
			setTimeout(() => {
				client.deleteMessages(chatId, [warning.id], {}).catch(() => {});
			}, 10000);
		} else {
			console.log(`🚫 Нарушение у ${userName}, автоудаление отключено (${getViolationReason(violationType)})`);
		}
	} catch (error) {
		console.error('Ошибка при обработке нарушения:', error);
	}
}
