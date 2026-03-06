/**
 * Утилиты для работы с ID чатов и медиа в userbot.
 */
import { ALLOWED_CHATS } from '../../config.js';

/** Приводит chatId к строке для сравнения. GramJS отдаёт BigInteger/Integer с .toString() или .value. */
export function getChatIdStr(chatId: unknown): string {
	if (chatId === undefined || chatId === null) return '';
	let s: string;
	if (typeof chatId === 'bigint') {
		s = String(chatId);
	} else if (typeof chatId === 'number' && !Number.isNaN(chatId)) {
		s = String(chatId);
	} else if (typeof chatId === 'object' && chatId !== null) {
		const obj = chatId as { toString?: () => string; value?: number | bigint };
		if (typeof obj.toString === 'function') {
			s = obj.toString();
		} else if (
			'value' in obj &&
			obj.value !== undefined &&
			obj.value !== null
		) {
			s = String(typeof obj.value === 'bigint' ? obj.value : obj.value);
		} else {
			s = String(chatId);
		}
	} else {
		s = String(chatId);
	}
	return s.replace(/^\-100/, '').replace(/^\-/, '').trim();
}

/** Нормализует ID для сравнения: и супергруппа -100xxx, и обычная группа -xxx дают xxx */
export function normalizeChatIdForCompare(id: string): string {
	return id.replace(/^\-100/, '').replace(/^\-/, '').trim();
}

/** Краткое название типа медиа для отчёта */
export function getMediaKind(media: unknown): string | undefined {
	if (!media || typeof media !== 'object') return undefined;
	const name = (media as { className?: string }).className ?? '';
	const map: Record<string, string> = {
		MessageMediaPhoto: 'фото',
		MessageMediaDocument: 'документ',
		MessageMediaGeo: 'геолокация',
		MessageMediaContact: 'контакт',
		MessageMediaUnsupported: 'медиа',
		MessageMediaWebPage: 'ссылка/веб-страница',
		MessageMediaVenue: 'место',
		MessageMediaDice: 'dice/дартс',
		MessageMediaStory: 'история',
	};
	if (map[name]) return map[name];
	if (name.startsWith('MessageMedia'))
		return name.replace('MessageMedia', '').toLowerCase();
	return undefined;
}

export function isAllowedChat(chatId: string): boolean {
	if (ALLOWED_CHATS.length === 0) return true;
	const normalized = normalizeChatIdForCompare(chatId);
	return ALLOWED_CHATS.some(
		(c) => normalizeChatIdForCompare(c) === normalized || c === chatId,
	);
}
