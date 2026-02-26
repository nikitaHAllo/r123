import type { TelegramClient } from 'telegram';
import { utils } from 'telegram';
import { NewMessage } from 'telegram/events';
import { ADMINS, ADMINS_RAW, ALLOWED_CHATS } from '../config.js';
import { setProfanity, setAdvertising } from '../state.js';
import {
	FILTER_PROFANITY,
	FILTER_ADVERTISING,
	USE_NEURAL_NETWORK,
} from '../state.js';
import { checkProfanity, checkAd, checkCustom } from '../filters.js';
import { analyzeSequentially } from '../neural.js';
import { handleViolationUserbot, getViolationReason } from './violationUserbot.js';
import { dbPromise, loadSettingsFromDB } from '../db.js';
import { loadTopicsFromDB } from '../neural.js';
import { parseDocumentFromBuffer } from './documentHandler.js';
import type { MessageData } from './documentHandler.js';

const pendingMessagesByChat = new Map<string, { messages: MessageData[]; fileName: string; rawData?: any }>();
let totalFilesProcessed = 0;

/** Актуальный набор ID админов (включая "me" после разрешения). */
let effectiveAdminIds = new Set<number>(ADMINS);

function getChatIdStr(chatId: unknown): string {
	if (chatId === undefined || chatId === null) return '';
	const s = String(chatId);
	return s.replace(/^\-100/, ''); // нормализация supergroup/channel
}

function isAllowedChat(chatId: string): boolean {
	if (ALLOWED_CHATS.length === 0) return true;
	const normalized = chatId.replace(/^\-100/, '');
	return ALLOWED_CHATS.some(c => c.replace(/^\-100/, '') === normalized || c === chatId);
}

function isAdmin(senderId: unknown): boolean {
	const id = typeof senderId === 'bigint' ? Number(senderId) : Number(senderId);
	return !isNaN(id) && effectiveAdminIds.has(id);
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
		console.error('Ошибка нейросети:', e);
		return null;
	}
}

const SETTINGS_SYNC_INTERVAL_MS = 10_000;

export async function registerUserbotHandlers(client: TelegramClient): Promise<void> {
	// Подхватываем настройки и темы из админки бота (общая БД)
	setInterval(async () => {
		await loadSettingsFromDB().catch(() => {});
		await loadTopicsFromDB().catch(() => {});
	}, SETTINGS_SYNC_INTERVAL_MS);

	// Разрешаем "me" в ADMINS — добавляем ID текущего аккаунта
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

	client.addEventHandler(
		async (event) => {
			const message = event.message;
			const text = (message.text || message.message || '').trim();
			const isOutgoing = (message as any).out === true;
			const isPrivate = event.isPrivate;

			// chatId: из события или из message.peerId (для ЛС/Избранного иногда нет в event.chatId)
			let chatId = event.chatId;
			let chatIdStr = chatId != null ? getChatIdStr(chatId) : '';
			if (!chatIdStr && message.peerId) {
				try {
					chatIdStr = getChatIdStr(utils.getPeerId(message.peerId));
				} catch {}
			}
			if (!chatIdStr) {
				if (isPrivate && text.startsWith('/'))
					console.log('[ЛС] Сообщение без chatId, пропуск. text:', text.slice(0, 30), 'out:', isOutgoing);
				return;
			}
			// Для отправки ответа используем event.chatId или peer из сообщения (важно для Избранного)
			const peerForSend = chatId ?? message.peerId;

			// «Избранное» = личный чат с собой. Всегда разрешаем. Иначе проверяем ALLOWED_CHATS.
			const isSavedMessages = isPrivate && isOutgoing;
			if (ALLOWED_CHATS.length > 0 && !isSavedMessages && !isAllowedChat(chatIdStr)) return;

			const isChannel = event.isChannel || (message as any).post;
			const senderId = (message as any).senderId ?? message.fromId;
			const userId = senderId != null ? (typeof senderId === 'bigint' ? Number(senderId) : senderId) : 0;
			let userName = 'Канал';
			try {
				const sender = await message.getSender();
				if (sender && typeof sender === 'object') {
					const s = sender as any;
					userName = s.username ? `@${s.username}` : (s.firstName || s.title || 'User');
				}
			} catch {}

			// Документ: загрузка и парсинг
			if (message.media && message.document) {
				if (!isAdmin(senderId) && isPrivate) return;
				try {
					const buffer = await client.downloadMedia(message, {});
					if (!buffer || !(buffer instanceof Buffer)) return;
					const fileName = (message.media as any)?.fileName ?? (message as any).fileName ?? 'file.json';
					if (!fileName.endsWith('.json') && !fileName.endsWith('.html')) {
						await client.sendMessage(peerForSend, {
							message: `⚠️ Файл ${fileName} не поддерживается. Допустимы .html, .json`,
						});
						return;
					}
					const result = parseDocumentFromBuffer(buffer as Buffer, fileName);
					if (!result) {
						await client.sendMessage(peerForSend, { message: '⚠️ Не удалось извлечь сообщения из файла.' });
						return;
					}
					totalFilesProcessed++;
					pendingMessagesByChat.set(chatIdStr, {
						messages: result.messages,
						fileName: result.fileName,
						rawData: result.rawData,
					});
					await client.sendMessage(peerForSend, {
						message: `✅ Файл ${result.fileName} загружен!\n📨 Сообщений: ${result.messages.length}\n\nДля анализа используйте команду /analyze`,
					});
				} catch (err: any) {
					console.error('Ошибка документа:', err);
					await client.sendMessage(peerForSend, {
						message: `❌ Ошибка: ${err.message || 'неизвестная'}`,
					});
				}
				return;
			}

			// Команды (админка только в боте; /start и /admin не отвечаем)
			if (text.startsWith('/')) {
				const cmd = text.split(/\s/)[0].toLowerCase();
				if (cmd === '/start' || cmd === '/admin') return;
				if (cmd === '/analyze' && isAdmin(senderId)) {
					const pending = pendingMessagesByChat.get(chatIdStr);
					if (!pending || pending.messages.length === 0) {
						await client.sendMessage(peerForSend, {
							message: '📭 Нет сообщений для анализа. Сначала загрузите файл.',
						});
						return;
					}
					const { startAnalysisUserbot } = await import('./analysisUserbot.js');
					startAnalysisUserbot(client, peerForSend, chatIdStr, pending.messages, pending.fileName, pending.rawData).catch((e) => {
						if (e instanceof Error && e.message !== 'cancelled') console.error('Анализ:', e);
					});
					return;
				}
				if ((cmd === '/check_chat' || cmd === '/stop_check_chat') && isAdmin(senderId)) {
					await client.sendMessage(peerForSend, {
						message: cmd === '/check_chat' ? '✅ Режим проверки чата включён (в ЛС буду анализировать ваши сообщения).' : '🛑 Режим отключён.',
					});
					return;
				}
				if (cmd === '/cancel_analysis' && isAdmin(senderId)) {
					const { cancelAnalysis } = await import('./analysisUserbot.js');
					const ok = cancelAnalysis(chatIdStr);
					await client.sendMessage(peerForSend, {
						message: ok ? '⏹ Анализ остановлен.' : '⚠️ Анализ не выполняется.',
					});
					return;
				}
				return;
			}

			// Проверку на нарушения делаем только для входящих (от других). Свои команды уже обработаны выше.
			if (isOutgoing) return;

			// Пустой текст (только медиа без подписи) — не проверяем
			const textLower = text.toLowerCase();
			if (!textLower) return;

			const chatTitle = event.chat ? (event.chat as any).title : undefined;
			const source = isChannel ? 'канал' : (isPrivate ? 'ЛС' : 'чат');
			const label = chatTitle || chatIdStr;
			console.log(`[реальное время] ${source}: ${label} | ${userName}: "${text.slice(0, 50)}${text.length > 50 ? '…' : ''}"`);

			let violation: string | null = null;
			if (USE_NEURAL_NETWORK && textLower.length > 3) {
				try {
					violation = await checkMessageWithNeural(textLower);
				} catch {}
			}
			if (!violation) violation = detectViolation(textLower);

			if (violation) {
				console.log(`  🚨 нарушение: ${violation}`);
				const peer = chatIdStr || (chatId != null ? String(chatId) : '');
				if (!peer) return;
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
				console.log(`  ✅ ок`);
				await dbPromise.then((db) =>
					db.run('INSERT INTO statistics (type,timestamp) VALUES (?,?)', ['message_ok', Math.floor(Date.now() / 1000)])
				);
			}
		},
		new NewMessage({})
	);

}

export { pendingMessagesByChat, totalFilesProcessed };
