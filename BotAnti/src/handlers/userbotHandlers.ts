import type { TelegramClient } from 'telegram';
import { utils } from 'telegram';
import { NewMessage } from 'telegram/events';
import { ADMINS, ADMINS_RAW, ALLOWED_CHATS } from '../config.js';
import {
	FILTER_PROFANITY,
	FILTER_ADVERTISING,
	USE_NEURAL_NETWORK,
} from '../state.js';
import { checkProfanity, checkAd, checkCustom } from '../filters.js';
import { analyzeSequentially } from '../neural.js';
import { handleViolationUserbot } from './violationUserbot.js';
import { dbPromise, loadSettingsFromDB } from '../db.js';
import { loadTopicsFromDB } from '../neural.js';

/** Актуальный набор ID админов (включая "me" после разрешения). */
const effectiveAdminIds = new Set<number>([]);

function getChatIdStr(chatId: unknown): string {
	if (chatId === undefined || chatId === null) return '';
	const s = String(chatId);
	return s.replace(/^\-100/, '');
}

function isAllowedChat(chatId: string): boolean {
	if (ALLOWED_CHATS.length === 0) return true;
	const normalized = chatId.replace(/^\-100/, '');
	return ALLOWED_CHATS.some(c => c.replace(/^\-100/, '') === normalized || c === chatId);
}

function detectViolation(text: string): string | null {
	if (FILTER_PROFANITY && checkProfanity(text)) return 'violation_profanity';
	if (FILTER_ADVERTISING && checkAd(text)) return 'violation_ad';
	if (checkCustom(text)) return 'violation_custom';
	return null;
}

async function checkMessageWithNeural(text: string): Promise<string | null> {
	try {
		const r = await analyzeSequentially(text);
		return r ? `neural_${r.topic}` : null;
	} catch (e) {
		if (e instanceof Error && e.message === 'cancelled') throw e;
		const msg = e instanceof Error ? e.message : String(e);
		console.error('Ошибка нейросети:', msg);
		return null;
	}
}

const SETTINGS_SYNC_INTERVAL_MS = 10_000;

/**
 * Userbot только:
 * - в реальном времени просматривает сообщения в разрешённых чатах;
 * - анализирует по промпту (нейросеть) и фильтрам (брань, реклама, кастом);
 * - отсылает нарушения в LOG_CHAT_IDS и при наличии BOT_USERNAME — в личку боту.
 * Админ-панель и импорт/анализ файлов — только через бота (общая БД синхронизируется раз в 10 сек).
 */
export async function registerUserbotHandlers(client: TelegramClient): Promise<void> {
	// Подхватываем настройки и темы из админки бота (общая БД)
	setInterval(async () => {
		await loadSettingsFromDB().catch(() => {});
		await loadTopicsFromDB().catch(() => {});
	}, SETTINGS_SYNC_INTERVAL_MS);

	if (ADMINS_RAW.includes('me')) {
		try {
			const me = await client.getMe();
			if (me?.id) {
				effectiveAdminIds.add(Number(me.id));
				console.log('Админ "me" добавлен, ID:', me.id);
			}
		} catch (e) {
			console.error('Не удалось получить getMe() для админа "me":', e);
		}
	}

	ADMINS.forEach(id => effectiveAdminIds.add(id));

	client.addEventHandler(
		async (event) => {
			const message = event.message;
			const text = (message.text || message.message || '').trim();
			const isOutgoing = (message as { out?: boolean }).out === true;
			const isPrivate = event.isPrivate;

			let chatIdStr = event.chatId != null ? getChatIdStr(event.chatId) : '';
			if (!chatIdStr && message.peerId) {
				try {
					chatIdStr = getChatIdStr(utils.getPeerId(message.peerId));
				} catch {}
			}
			if (!chatIdStr) return;

			const peerForSend = event.chatId ?? message.peerId;
			const isSavedMessages = isPrivate && isOutgoing;
			if (ALLOWED_CHATS.length > 0 && !isSavedMessages && !isAllowedChat(chatIdStr)) return;

			// Документы и файлы не обрабатываем — только через бота
			if (message.media && message.document) return;

			// Проверку на нарушения — только для входящих сообщений с текстом
			if (isOutgoing) return;
			const textLower = text.toLowerCase();
			if (!textLower) return;

			const isChannel = event.isChannel || (message as { post?: boolean }).post;
			const senderId = (message as { senderId?: unknown }).senderId ?? message.fromId;
			const userId: number = senderId != null
				? (typeof senderId === 'bigint' ? Number(senderId) : typeof senderId === 'number' ? senderId : Number(senderId) || 0)
				: 0;
			let userName = 'Канал';
			try {
				const sender = await message.getSender();
				if (sender && typeof sender === 'object') {
					const s = sender as { username?: string; firstName?: string; title?: string };
					userName = s.username ? `@${s.username}` : (s.firstName || s.title || 'User');
				}
			} catch {}

			const chatTitle = event.chat ? (event.chat as { title?: string }).title : undefined;
			const source = isChannel ? 'канал' : (isPrivate ? 'ЛС' : 'чат');
			const label = chatTitle || chatIdStr;
			console.log(`[реальное время] ${source}: ${label} | ${userName}: "${text.slice(0, 50)}${text.length > 50 ? '…' : ''}"`);

			// Сначала фильтры — если сработали, нейросеть не вызываем
			let violation: string | null = detectViolation(textLower);
			if (!violation && USE_NEURAL_NETWORK && textLower.length > 3) {
				try {
					violation = await checkMessageWithNeural(textLower);
				} catch {}
			}

			const peer = chatIdStr || (event.chatId != null ? String(event.chatId) : '');
			if (!peer) return;

			if (violation) {
				console.log(`  🚨 нарушение: ${violation}`);
				await handleViolationUserbot(
					client,
					peer,
					message.id,
					userId,
					userName,
					text,
					violation,
					chatTitle,
					isPrivate,
				);
			} else {
				console.log(`  ✅ Текст не нарушает правила`);
				await dbPromise.then((db) =>
					db.run('INSERT INTO statistics (type,timestamp) VALUES (?,?)', ['message_ok', Math.floor(Date.now() / 1000)])
				);
			}
		},
		new NewMessage({})
	);
}
