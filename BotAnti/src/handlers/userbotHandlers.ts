import type { TelegramClient } from 'telegram';
import { utils } from 'telegram';
import { NewMessage } from 'telegram/events/index.js';
import { ADMINS, ADMINS_RAW, ALLOWED_CHATS } from '../config.js';
import { loadSettingsFromDB } from '../db.js';
import { loadTopicsFromDB } from '../neural.js';
import {
	getChatIdStr,
	normalizeChatIdForCompare,
	isAllowedChat,
	getMediaKind,
} from './userbot/chatIdUtils.js';
import { processOneMessage } from './userbot/processUserbotMessage.js';
import { startUserbotPolling } from './userbot/pollChannels.js';
import type { ViolationExtra } from './violationUserbot.js';

const effectiveAdminIds = new Set<number>([]);
const SETTINGS_SYNC_INTERVAL_MS = 6_000;
const GET_DIALOGS_INTERVAL_MS = 30_000;

// Userbot: реалтайм сообщения, нейросеть+фильтры; админка и файлы — через бота.
export async function registerUserbotHandlers(
	client: TelegramClient,
): Promise<void> {
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
	ADMINS.forEach((id) => effectiveAdminIds.add(id));

	if (ALLOWED_CHATS.length > 0) {
		console.log(
			'Режим реального времени: только чаты из ALLOWED_CHATS:',
			ALLOWED_CHATS.join(', '),
		);
		console.log(
			'Важно: юзербот должен состоять в канале/чате (аккаунт добавлен), иначе Telegram не присылает сообщения.',
		);
		try {
			const dialogs = await client.getDialogs({ limit: 200 });
			const dialogIds = new Set(
				dialogs.map((d: { id?: unknown }) => getChatIdStr(d.id)),
			);
			const found: string[] = [];
			const missing: string[] = [];
			for (const chatId of ALLOWED_CHATS) {
				const norm = normalizeChatIdForCompare(chatId);
				if (dialogIds.has(norm)) found.push(chatId);
				else missing.push(chatId);
			}
			console.log(
				'  ✓ загружено диалогов:',
				dialogs.length,
				'| чаты из списка в диалогах:',
				found.length + '/' + ALLOWED_CHATS.length,
			);
			if (missing.length > 0) {
				console.log(
					'  ⚠ не в топ-200 диалогов (обновления могут не приходить):',
					missing.join(', '),
				);
			}
		} catch (e) {
			console.warn('  ✗ getDialogs:', (e as Error).message);
		}
		setInterval(async () => {
			try {
				await client.getDialogs({ limit: 100 });
			} catch {}
		}, GET_DIALOGS_INTERVAL_MS);
		for (const chatId of ALLOWED_CHATS) {
			try {
				await client.getEntity(chatId);
				await client.getMessages(chatId, { limit: 1 });
				console.log('  ✓ подписка на чат:', chatId);
			} catch (e) {
				console.warn(
					'  ✗ не удалось загрузить чат',
					chatId,
					'—',
					(e as Error).message,
				);
			}
		}
		startUserbotPolling(client);
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

			const isSavedMessages = isPrivate && isOutgoing;
			if (
				ALLOWED_CHATS.length > 0 &&
				!isSavedMessages &&
				!isAllowedChat(chatIdStr)
			) {
				console.log(
					'[пропуск] чат не в списке: id=',
					chatIdStr,
					'(raw:',
					event.chatId?.toString?.() ?? event.chatId,
					')',
				);
				return;
			}

			if (message.media && message.document) return;
			if (isOutgoing) return;
			const textLower = text.toLowerCase();
			if (!textLower) return;

			const senderId =
				(message as { senderId?: unknown }).senderId ?? message.fromId;
			const userId: number =
				senderId != null
					? typeof senderId === 'bigint'
						? Number(senderId)
						: typeof senderId === 'number'
							? senderId
							: Number(senderId) || 0
					: 0;
			let userName = 'Канал';
			try {
				const sender = await message.getSender();
				if (sender && typeof sender === 'object') {
					const s = sender as {
						username?: string;
						firstName?: string;
						title?: string;
					};
					userName = s.username
						? `@${s.username}`
						: s.firstName || s.title || 'User';
				}
			} catch {}

			const chatTitle = event.chat
				? (event.chat as { title?: string }).title
				: undefined;
			const peer =
				chatIdStr || (event.chatId != null ? String(event.chatId) : '');
			if (!peer) return;
			const fullId = event.chatId?.toString?.() ?? peer;
			const chat = event.chat as { username?: string } | undefined;
			const replyTo = (message as { replyTo?: { replyToMsgId?: number } })
				.replyTo;
			const fwd = (
				message as { fwdFrom?: { fromName?: string; date?: number } }
			).fwdFrom;
			const editDate = (message as { editDate?: number }).editDate;
			const msgExt = message as {
				views?: number;
				forwards?: number;
				viaBotId?: unknown;
				postAuthor?: string;
				media?: unknown;
			};
			const viaBotId =
				msgExt.viaBotId != null ? Number(msgExt.viaBotId) : undefined;
			const extra: ViolationExtra = {
				chatUsername: chat?.username,
				replyToMsgId: replyTo?.replyToMsgId,
				fwdFrom: fwd ? { fromName: fwd.fromName, date: fwd.date } : undefined,
				editDate: editDate,
				views: msgExt.views,
				forwards: msgExt.forwards,
				viaBotId: Number.isNaN(viaBotId) ? undefined : viaBotId,
				postAuthor: msgExt.postAuthor,
				mediaKind: getMediaKind(msgExt.media),
			};
			console.log('');
			console.log(
				`┌── [реальное время] Канал ID: ${fullId}${chatTitle ? ` | ${chatTitle}` : ''}`,
			);
			console.log(
				`│ ${userName}: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`,
			);
			const msgDate = (message as { date?: number }).date;
			await processOneMessage(
				client,
				peer,
				message.id,
				userId,
				userName,
				text,
				chatTitle,
				!!isPrivate,
				fullId,
				msgDate,
				extra,
			);
			console.log(`└── Текст не нарушает правила`);
		},
		new NewMessage(
			ALLOWED_CHATS.length > 0
				? { incoming: true, chats: [...ALLOWED_CHATS] }
				: { incoming: true },
		),
	);
}
