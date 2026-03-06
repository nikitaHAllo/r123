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

/** Приводит chatId к строке для сравнения. GramJS отдаёт BigInteger/Integer с .toString() или .value. */
function getChatIdStr(chatId: unknown): string {
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
		} else if ('value' in obj && obj.value !== undefined && obj.value !== null) {
			s = String(typeof obj.value === 'bigint' ? obj.value : obj.value);
		} else {
			s = String(chatId);
		}
	} else {
		s = String(chatId);
	}
	// Нормализуем: -100xxxxxxxxxx или -xxxxxxxxx (обычная группа) -> xxxxxxxxxx
	return s.replace(/^\-100/, '').replace(/^\-/, '').trim();
}

/** Нормализует ID для сравнения: и супергруппа -100xxx, и обычная группа -xxx дают xxx */
function normalizeChatIdForCompare(id: string): string {
	return id.replace(/^\-100/, '').replace(/^\-/, '').trim();
}

function isAllowedChat(chatId: string): boolean {
	if (ALLOWED_CHATS.length === 0) return true;
	const normalized = normalizeChatIdForCompare(chatId);
	return ALLOWED_CHATS.some(c => normalizeChatIdForCompare(c) === normalized || c === chatId);
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
		const err = e as { code?: string; message?: string };
		const msg = err?.message ?? String(e);
		const isTimeout =
			err?.code === 'ECONNABORTED' || /timeout|ETIMEDOUT/i.test(msg);
		if (isTimeout) {
			console.error('Ошибка нейросети: таймаут (15 с). Проверьте OLLAMA_URL и доступность Ollama.');
		} else {
			console.error('Ошибка нейросети:', msg);
		}
		return null;
	}
}

const SETTINGS_SYNC_INTERVAL_MS = 10_000;
/** Интервал опроса каналов (мс). Меньше 8–10 сек — риск FloodWait от Telegram. */
const POLL_CHATS_INTERVAL_MS = 10_000;
/** Пауза между запросами к разным каналам (мс), чтобы не дергать GetHistory подряд. */
const POLL_DELAY_BETWEEN_CHATS_MS = 2_000;

/** Обрабатывает одно сообщение (фильтры + нейросеть + логирование). Используется и в событиях, и в polling. */
async function processOneMessage(
	client: TelegramClient,
	chatIdStr: string,
	messageId: number,
	userId: number,
	userName: string,
	text: string,
	chatTitle: string | undefined,
	isPrivate: boolean,
	channelIdForLog?: string,
): Promise<void> {
	const channelLabel = channelIdForLog ?? chatIdStr;
	const textLower = text.toLowerCase();
	let violation: string | null = detectViolation(textLower);
	if (violation) {
		console.log('  (фильтр сработал, нейросеть не вызываем)');
	} else if (USE_NEURAL_NETWORK && textLower.length > 3) {
		console.log('  проверка нейросетью…');
		try {
			violation = await checkMessageWithNeural(textLower);
		} catch {}
	}
	if (violation) {
		console.log(`  🚨 [канал ${channelLabel}] нарушение: ${violation}`);
		await handleViolationUserbot(
			client,
			chatIdStr,
			messageId,
			userId,
			userName,
			text,
			violation,
			chatTitle,
			isPrivate,
		);
	} else {
		await dbPromise.then((db) =>
			db.run('INSERT INTO statistics (type,timestamp) VALUES (?,?)', ['message_ok', Math.floor(Date.now() / 1000)])
		);
	}
}

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

	const GET_DIALOGS_INTERVAL_MS = 30_000; // каждые 30 сек — обход для GramJS, иначе обновления каналов могут перестать приходить

	if (ALLOWED_CHATS.length > 0) {
		console.log('Режим реального времени: только чаты из ALLOWED_CHATS:', ALLOWED_CHATS.join(', '));
		console.log('Важно: юзербот должен состоять в канале/чате (аккаунт добавлен), иначе Telegram не присылает сообщения.');
		const allowedSet = new Set(ALLOWED_CHATS.map(c => normalizeChatIdForCompare(c)));
		// Загружаем диалоги (лимит побольше, чтобы нужные каналы попали в список)
		try {
			const dialogs = await client.getDialogs({ limit: 200 });
			const dialogIds = new Set(dialogs.map((d: { id?: unknown }) => getChatIdStr(d.id)));
			const found: string[] = [];
			const missing: string[] = [];
			for (const chatId of ALLOWED_CHATS) {
				const norm = normalizeChatIdForCompare(chatId);
				if (dialogIds.has(norm)) found.push(chatId);
				else missing.push(chatId);
			}
			console.log('  ✓ загружено диалогов:', dialogs.length, '| чаты из списка в диалогах:', found.length + '/' + ALLOWED_CHATS.length);
			if (missing.length > 0) {
				console.log('  ⚠ не в топ-200 диалогов (обновления могут не приходить):', missing.join(', '));
			}
		} catch (e) {
			console.warn('  ✗ getDialogs:', (e as Error).message);
		}
		// Периодически обновлять список диалогов — иначе GramJS перестаёт получать обновления по каналам
		setInterval(async () => {
			try {
				await client.getDialogs({ limit: 100 });
			} catch {}
		}, GET_DIALOGS_INTERVAL_MS);
		// Для каждого чата — сущность + последнее сообщение (подписка на pts канала)
		for (const chatId of ALLOWED_CHATS) {
			try {
				await client.getEntity(chatId);
				await client.getMessages(chatId, { limit: 1 });
				console.log('  ✓ подписка на чат:', chatId);
			} catch (e) {
				console.warn('  ✗ не удалось загрузить чат', chatId, '—', (e as Error).message);
			}
		}
		// Опрос каналов раз в N сек — обход для чатов, по которым Telegram не присылает обновления
		const lastSeenIdByChat = new Map<string, number>();
		const chatTitleCache = new Map<string, string>();
		const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
		setInterval(async () => {
			for (let i = 0; i < ALLOWED_CHATS.length; i++) {
				if (i > 0) await sleep(POLL_DELAY_BETWEEN_CHATS_MS);
				const chatId = ALLOWED_CHATS[i];
				try {
					if (!chatTitleCache.has(chatId)) {
						try {
							const entity = await client.getEntity(chatId);
							const title = (entity as { title?: string })?.title ?? '';
							if (title) chatTitleCache.set(chatId, title);
						} catch {}
					}
					const list = await client.getMessages(chatId, { limit: 15 });
					const normChat = normalizeChatIdForCompare(chatId);
					const messages = [...(list || [])].reverse();
					// При первом опросе только запоминаем последний id, не обрабатываем историю
					if (!lastSeenIdByChat.has(normChat)) {
						const ids = messages.map((m: { id?: number }) => typeof m.id === 'number' ? m.id : Number(m.id));
						lastSeenIdByChat.set(normChat, ids.length ? Math.max(...ids) : 0);
						continue;
					}
					const lastSeen = lastSeenIdByChat.get(normChat) ?? 0;
					let maxId = lastSeen;
					for (const msg of messages) {
						const id = typeof msg.id === 'number' ? msg.id : Number(msg.id);
						if (id <= lastSeen) continue;
						const text = (msg.message ?? (msg as { text?: string }).text ?? '').trim();
						const isOut = (msg as { out?: boolean }).out === true;
						if (!text || isOut) continue;
						const senderId = (msg as { fromId?: unknown }).fromId ?? (msg as { senderId?: unknown }).senderId;
						const userId = senderId != null ? (typeof senderId === 'object' && senderId && 'userId' in senderId ? Number((senderId as { userId: unknown }).userId) : Number(senderId)) : 0;
						let userName = 'Канал';
						try {
							const sender = await (msg as { getSender?: () => Promise<unknown> }).getSender?.();
							if (sender && typeof sender === 'object') {
								const s = sender as { username?: string; firstName?: string; title?: string };
								userName = s.username ? `@` + s.username : (s.firstName || s.title || 'User');
							}
						} catch {}
						const title = chatTitleCache.get(chatId) ?? '';
						console.log('');
						console.log(`┌── [опрос] Канал ID: ${chatId}${title ? ` | ${title}` : ''}`);
						console.log(`│ ${userName}: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`);
						await processOneMessage(client, chatId, id, userId, userName, text, undefined, false, chatId);
						console.log(`└── Текст не нарушает правила`);
						if (id > maxId) maxId = id;
					}
					if (maxId > lastSeen) lastSeenIdByChat.set(normChat, maxId);
				} catch (e) {
					// тихо игнорируем ошибки опроса (лимиты, сеть)
				}
			}
		}, POLL_CHATS_INTERVAL_MS);
		console.log('  ✓ опрос каналов каждые', POLL_CHATS_INTERVAL_MS / 1000, 'с');
	} else {
		console.log('Режим реального времени: все чаты (ALLOWED_CHATS пуст).');
	}

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
			if (ALLOWED_CHATS.length > 0 && !isSavedMessages && !isAllowedChat(chatIdStr)) {
				console.log('[пропуск] чат не в списке: id=', chatIdStr, '(raw:', event.chatId?.toString?.() ?? event.chatId, ')');
				return;
			}

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
			const peer = chatIdStr || (event.chatId != null ? String(event.chatId) : '');
			if (!peer) return;
			const fullId = event.chatId?.toString?.() ?? peer;
			console.log('');
			console.log(`┌── [реальное время] Канал ID: ${fullId}${chatTitle ? ` | ${chatTitle}` : ''}`);
			console.log(`│ ${userName}: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`);
			await processOneMessage(client, peer, message.id, userId, userName, text, chatTitle, !!isPrivate, fullId);
			console.log(`└── Текст не нарушает правила`);
		},
		// Явно указываем чаты — библиотека подгрузит их при resolve и может начать получать обновления
		new NewMessage(ALLOWED_CHATS.length > 0 ? { incoming: true, chats: [...ALLOWED_CHATS] } : { incoming: true })
	);
}
