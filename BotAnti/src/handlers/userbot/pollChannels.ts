// Fallback-опрос каналов, если Telegram не присылает обновления.
import type { TelegramClient } from 'telegram';
import { ALLOWED_CHATS } from '../../config.js';
import {
	normalizeChatIdForCompare,
	getMediaKind,
} from './chatIdUtils.js';
import { processOneMessage } from './processUserbotMessage.js';
import type { ViolationExtra } from '../violationUserbot.js';

const POLL_CHATS_INTERVAL_MS = 10_000;
const POLL_DELAY_BETWEEN_CHATS_MS = 2_000;

export function startUserbotPolling(client: TelegramClient): void {
	const lastSeenIdByChat = new Map<string, number>();
	const chatTitleCache = new Map<string, string>();
	const chatUsernameCache = new Map<string, string>();
	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

	setInterval(async () => {
		for (let i = 0; i < ALLOWED_CHATS.length; i++) {
			if (i > 0) await sleep(POLL_DELAY_BETWEEN_CHATS_MS);
			const chatId = ALLOWED_CHATS[i];
			try {
				if (!chatTitleCache.has(chatId)) {
					try {
						const entity = await client.getEntity(chatId);
						const e = entity as { title?: string; username?: string };
						if (e?.title) chatTitleCache.set(chatId, e.title);
						if (e?.username) chatUsernameCache.set(chatId, e.username);
					} catch {}
				}
				const list = await client.getMessages(chatId, { limit: 15 });
				const normChat = normalizeChatIdForCompare(chatId);
				const messages = [...(list || [])].reverse();
				if (!lastSeenIdByChat.has(normChat)) {
					const ids = messages.map((m: { id?: number }) =>
						typeof m.id === 'number' ? m.id : Number(m.id),
					);
					lastSeenIdByChat.set(normChat, ids.length ? Math.max(...ids) : 0);
					continue;
				}
				const lastSeen = lastSeenIdByChat.get(normChat) ?? 0;
				let maxId = lastSeen;
				for (const msg of messages) {
					const id = typeof msg.id === 'number' ? msg.id : Number(msg.id);
					if (id <= lastSeen) continue;
					const text = (
						msg.message ??
						(msg as { text?: string }).text ??
						''
					).trim();
					const isOut = (msg as { out?: boolean }).out === true;
					if (!text || isOut) continue;
					const senderId =
						(msg as { fromId?: unknown }).fromId ??
						(msg as { senderId?: unknown }).senderId;
					const userId =
						senderId != null
							? typeof senderId === 'object' &&
									senderId &&
									'userId' in senderId
								? Number((senderId as { userId: unknown }).userId)
								: Number(senderId)
							: 0;
					let userName = 'Канал';
					try {
						const sender = await (
							msg as { getSender?: () => Promise<unknown> }
						).getSender?.();
						if (sender && typeof sender === 'object') {
							const s = sender as {
								username?: string;
								firstName?: string;
								title?: string;
							};
							userName = s.username
								? `@` + s.username
								: s.firstName || s.title || 'User';
						}
					} catch {}
					const title = chatTitleCache.get(chatId) ?? '';
					const replyTo = (msg as { replyTo?: { replyToMsgId?: number } })
						.replyTo;
					const fwd = (
						msg as { fwdFrom?: { fromName?: string; date?: number } }
					).fwdFrom;
					const editDate = (msg as { editDate?: number }).editDate;
					const msgExt = msg as {
						views?: number;
						forwards?: number;
						viaBotId?: unknown;
						postAuthor?: string;
						media?: unknown;
					};
					const viaBotId =
						msgExt.viaBotId != null ? Number(msgExt.viaBotId) : undefined;
					const extra: ViolationExtra = {
						chatUsername: chatUsernameCache.get(chatId),
						replyToMsgId: replyTo?.replyToMsgId,
						fwdFrom: fwd
							? { fromName: fwd.fromName, date: fwd.date }
							: undefined,
						editDate: editDate,
						views: msgExt.views,
						forwards: msgExt.forwards,
						viaBotId: Number.isNaN(viaBotId) ? undefined : viaBotId,
						postAuthor: msgExt.postAuthor,
						mediaKind: getMediaKind(msgExt.media),
					};
					console.log('');
					console.log(
						`┌── [опрос] Канал ID: ${chatId}${title ? ` | ${title}` : ''}`,
					);
					console.log(
						`│ ${userName}: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`,
					);
					const msgDate = (msg as { date?: number }).date;
					await processOneMessage(
						client,
						chatId,
						id,
						userId,
						userName,
						text,
						title || undefined,
						false,
						chatId,
						msgDate,
						extra,
					);
					console.log(`└── Текст не нарушает правила`);
					if (id > maxId) maxId = id;
				}
				if (maxId > lastSeen) lastSeenIdByChat.set(normChat, maxId);
			} catch {}
		}
	}, POLL_CHATS_INTERVAL_MS);

	console.log('  ✓ опрос каналов каждые', POLL_CHATS_INTERVAL_MS / 1000, 'с');
}
