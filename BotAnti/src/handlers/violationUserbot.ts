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

function formatMessageDate(unixTimestamp?: number): string {
	if (unixTimestamp == null || unixTimestamp <= 0) return '—';
	const d = new Date(unixTimestamp * 1000);
	return d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

function getMessageLink(chatId: string | number, messageId: number): string {
	const idStr = String(chatId).replace(/^-100/, '');
	if (/^\d+$/.test(idStr)) return `https://t.me/c/${idStr}/${messageId}`;
	return '—';
}

export interface ViolationExtra {
	chatUsername?: string;
	replyToMsgId?: number;
	fwdFrom?: { fromName?: string; fromId?: string; date?: number };
	editDate?: number;
	views?: number;
	forwards?: number;
	viaBotId?: number;
	postAuthor?: string;
	mediaKind?: string;
}

async function logViolation(
	client: TelegramClient,
	chatId: string | number,
	userId: string | number,
	violationType: string,
	text: string,
	messageId: number,
	chatTitle: string | undefined,
	userName: string,
	messageDate?: number,
	extra?: ViolationExtra
) {
	const cleanText = text.replace(new RegExp(`\\s*\\(${userId}\\)\\s*$`), '').trim();
	const reason = getViolationReason(violationType);
	const dateStr = formatMessageDate(messageDate);
	const link = getMessageLink(chatId, messageId);

	const lines: string[] = [
		'🚨 Нарушение!',
		`📌 Чат: ${chatId}${chatTitle ? ` (${chatTitle})` : ''}${extra?.chatUsername ? ` @${extra.chatUsername}` : ''}`,
		`👤 Пользователь: ${userName} (ID User: ${userId})`,
		`📅 Дата: ${dateStr}`,
		`🔗 Ссылка: ${link}`,
	];
	if (extra?.replyToMsgId != null) {
		lines.push(`↩️ Ответ на сообщение: #${extra.replyToMsgId}`);
	}
	if (extra?.fwdFrom) {
		const f = extra.fwdFrom;
		const from = [f.fromName, f.fromId].filter(Boolean).join(' ') || '—';
		const fwdDate = f.date != null ? formatMessageDate(f.date) : '';
		lines.push(`📤 Переслано: ${from}${fwdDate ? `, ${fwdDate}` : ''}`);
	}
	if (extra?.editDate != null && extra.editDate > 0) {
		lines.push(`✏️ Редактировано: ${formatMessageDate(extra.editDate)}`);
	}
	if (extra?.views != null && extra.views > 0) {
		lines.push(`👁 Просмотры: ${extra.views}`);
	}
	if (extra?.forwards != null && extra.forwards > 0) {
		lines.push(`↗️ Переслано раз: ${extra.forwards}`);
	}
	if (extra?.viaBotId != null) {
		lines.push(`🤖 Через бота (ID): ${extra.viaBotId}`);
	}
	if (extra?.postAuthor) {
		lines.push(`✍️ Автор поста: ${extra.postAuthor}`);
	}
	if (extra?.mediaKind) {
		lines.push(`📎 Вложение: ${extra.mediaKind}`);
	}
	lines.push(`Тип: ${reason}`, '', `Текст: ${cleanText}`);
	const msg = lines.join('\n');

	for (const dest of LOG_CHAT_IDS) {
		try {
			let entity: string | number | object = dest.toLowerCase() === 'me' ? 'me' : dest;
			if (entity !== 'me' && /^\d+$/.test(String(dest))) {
				try {
					entity = (await client.getEntity(parseInt(String(dest), 10))) as string | number | object;
				} catch {
					console.error(
						`Получатель ${dest}: пользователь не в кэше. Пусть напишет вашему аккаунту (userbot) в ЛС хотя бы раз, либо укажите LOG_CHAT_ID=me`
					);
					continue;
				}
			}
			await client.sendMessage(entity as Parameters<TelegramClient['sendMessage']>[0], { message: msg });
			await client.forwardMessages(entity as Parameters<TelegramClient['forwardMessages']>[0], {
				messages: [messageId],
				fromPeer: chatId,
			});
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			console.error(`Ошибка логирования нарушения (получатель ${dest}):`, errMsg);
		}
	}

	const botName = BOT_USERNAME ?? '';
	let botAlreadyInList = botName && LOG_CHAT_IDS.some(
		(d) => String(d).trim().replace(/^@/, '').toLowerCase() === botName.toLowerCase()
	);
	if (botName && !botAlreadyInList) {
		try {
			const botEntity = await client.getEntity(`@${botName}`) as unknown as { id?: unknown };
			const rawId = botEntity?.id;
			const botId = rawId != null ? String(rawId) : null;
			if (botId && LOG_CHAT_IDS.some((d) => String(d).trim() === botId)) {
				botAlreadyInList = true;
			}
		} catch {}
	}
	if (botName && !botAlreadyInList) {
		try {
			await client.sendMessage(`@${botName}`, { message: msg });
			await client.forwardMessages(`@${botName}`, {
				messages: [messageId],
				fromPeer: chatId,
			});
			console.log(`  📤 Отчёт отправлен боту @${botName}`);
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			console.error(`Ошибка отправки отчёта боту @${botName}:`, errMsg);
		}
	} else if (!botName) {
		console.log('  ⚠️ BOT_USERNAME не задан в .env — отчёт в бота не отправляется');
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
	isPrivate?: boolean,
	messageDate?: number,
	extra?: ViolationExtra
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
		userName,
		messageDate,
		extra
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
		const errMsg = error instanceof Error ? error.message : String(error);
		console.error('Ошибка при обработке нарушения:', errMsg);
	}
}
