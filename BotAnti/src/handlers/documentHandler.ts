import { Bot, Context } from 'grammy';
import { BOT_TOKEN } from '../config.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

export interface MessageData {
	author: string;
	text: string;
	userId?: string | number;
}

export interface UserInfo {
	userId: string;
	name: string;
}

export interface ProcessedDocument {
	messages: MessageData[];
	fileName: string;
	rawData?: any;
}

function extractUserIdFromMessage(msg: any): string | number | undefined {
	if (msg.type === 'service' && msg.actor_id) {
		if (typeof msg.actor_id === 'string' || typeof msg.actor_id === 'number') {
			return msg.actor_id;
		} else if (msg.actor_id.user_id) {
			return msg.actor_id.user_id;
		}
	}

	if (msg.type === 'message' || !msg.type) {
		if (msg.from_id) {
			if (typeof msg.from_id === 'string' || typeof msg.from_id === 'number') {
				return msg.from_id;
			} else if (msg.from_id.user_id) {
				return msg.from_id.user_id;
			} else if (msg.from_id.channel_id) {
				return msg.from_id.channel_id;
			}
		} else if (msg.from_id_user_id) {
			return msg.from_id_user_id;
		}
	}

	return undefined;
}

function parseJsonMessages(data: any): MessageData[] {
	const messages: MessageData[] = [];
	if (!Array.isArray(data.messages)) return messages;

	for (const msg of data.messages) {
		if (msg.type === 'service') {
			const userId = extractUserIdFromMessage(msg);
			if (userId && msg.actor) {
				let text = '';
				if (msg.text) {
					if (typeof msg.text === 'string') {
						text = msg.text;
					} else if (Array.isArray(msg.text)) {
						text = msg.text
							.map((t: any) => (typeof t === 'string' ? t : t.text))
							.join('');
					}
				}

				if (text.trim()) {
					messages.push({
						author: msg.actor || msg.from || 'System',
						text: text.trim(),
						userId: userId
					});
				}
			}
			continue;
		}

		if (!msg.from || !msg.text) continue;

		let text = '';
		if (typeof msg.text === 'string') {
			text = msg.text;
		} else if (Array.isArray(msg.text)) {
			text = msg.text
				.map((t: any) => (typeof t === 'string' ? t : t.text))
				.join('');
		}

		if (text.trim()) {
			const userId = extractUserIdFromMessage(msg);
			messages.push({ 
				author: msg.from, 
				text: text.trim(),
				userId: userId
			});
		}
	}
	return messages;
}

function normalizeUserId(userId: string | number | undefined): string | null {
	if (userId === undefined || userId === null) return null;
	
	const userIdStr = String(userId);
	if (userIdStr.startsWith('user')) {
		return userIdStr;
	}
	const numericMatch = userIdStr.match(/\d+/);
	if (numericMatch) {
		return `user${numericMatch[0]}`;
	}
	return null;
}

export function extractUniqueUsers(data: any): UserInfo[] {
	const usersMap = new Map<string, UserInfo>();
	if (!Array.isArray(data.messages)) return [];

	for (const msg of data.messages) {
		let userId: string | number | undefined;
		let userName: string | undefined;

		if (msg.type === 'service') {
			userId = extractUserIdFromMessage(msg);
			userName = msg.actor || msg.from;
		}
		else if (msg.type === 'message' || !msg.type) {
			userId = extractUserIdFromMessage(msg);
			userName = msg.from;
		}

		if (userId) {
			const normalizedId = normalizeUserId(userId);
			if (normalizedId && userName) {
				const existing = usersMap.get(normalizedId);
				if (!existing || existing.name === 'Неизвестный пользователь') {
					usersMap.set(normalizedId, {
						userId: normalizedId,
						name: userName
					});
				}
			}
		}

		if (msg.reactions) {
			let recentReactions: any[] = [];

			if (Array.isArray(msg.reactions)) {
				for (const reaction of msg.reactions) {
					if (reaction.recent && Array.isArray(reaction.recent)) {
						recentReactions.push(...reaction.recent);
					}
					if (reaction.from_id && !reaction.recent) {
						recentReactions.push(reaction);
					}
				}
			}
			else if (msg.reactions.recent && Array.isArray(msg.reactions.recent)) {
				recentReactions = msg.reactions.recent;
			}
			else if (Array.isArray(msg.reactions)) {
				recentReactions = msg.reactions;
			}

			for (const recentReaction of recentReactions) {
				if (recentReaction.from_id) {
					let reactionUserId: string | number | undefined;
					if (typeof recentReaction.from_id === 'string' || typeof recentReaction.from_id === 'number') {
						reactionUserId = recentReaction.from_id;
					} else if (recentReaction.from_id.user_id) {
						reactionUserId = recentReaction.from_id.user_id;
					}

					if (reactionUserId) {
						const normalizedId = normalizeUserId(reactionUserId);
						if (normalizedId) {
							if (!usersMap.has(normalizedId)) {
								const existingMsg = data.messages.find((m: any) => {
									const id = extractUserIdFromMessage(m);
									const normalizedMsgId = normalizeUserId(id);
									return normalizedMsgId === normalizedId;
								});
								
								const userName = existingMsg?.from || existingMsg?.actor || 'Неизвестный пользователь';
								usersMap.set(normalizedId, {
									userId: normalizedId,
									name: userName
								});
							}
						}
					}
				}
			}
		}
	}

	return Array.from(usersMap.values()).sort((a, b) => a.userId.localeCompare(b.userId));
}

function parseHtmlMessages(html: string): MessageData[] {
	const $ = cheerio.load(html);
	const messages: MessageData[] = [];
	let currentAuthor = '';
	let currentUserId: string | number | undefined;

	$('div.message').each((_, el) => {
		const $el = $(el);
		const author =
			$el.find('.from_name').text().trim() || $el.find('.from').text().trim();

		if (author) currentAuthor = author;

		const peerId = $el.attr('data-peer-id') || 
		               $el.find('[data-peer-id]').first().attr('data-peer-id') ||
		               $el.attr('data-from-id');
		
		if (peerId) {
			const idMatch = peerId.toString().match(/(\d+)/);
			if (idMatch) {
				currentUserId = idMatch[1];
			}
		}

		const text = $el.find('.text').text().trim();
		if (currentAuthor && text) {
			messages.push({ 
				author: currentAuthor, 
				text,
				userId: currentUserId
			});
		}
	});

	return messages;
}

export async function processDocument(
	ctx: Context,
	bot: Bot
): Promise<ProcessedDocument | null> {
	try {
		const file = ctx.message?.document;
		if (!file) return null;

		const fileName = file.file_name || 'без_имени';
		if (!fileName.endsWith('.html') && !fileName.endsWith('.json')) {
			await ctx.reply(
				`⚠️ Файл ${fileName} не поддерживается. Допустимые форматы: .html, .json`
			);
			return null;
		}

		const fileInfo = await bot.api.getFile(file.file_id);
		if (!fileInfo.file_path) {
			await ctx.reply(
				'❌ Не удалось получить путь к файлу через Telegram API.'
			);
			return null;
		}

		const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
		const response = await axios.get<ArrayBuffer>(fileUrl, {
			responseType: 'arraybuffer',
		});
		const bodyStr = Buffer.from(response.data).toString('utf-8');

		let parsedData: any = null;
		const messages = fileName.endsWith('.json')
			? (() => {
				parsedData = JSON.parse(bodyStr);
				return parseJsonMessages(parsedData);
			})()
			: parseHtmlMessages(bodyStr);

		if (messages.length === 0) {
			await ctx.reply('⚠️ Не удалось извлечь сообщения из файла.');
			return null;
		}

		return { 
			messages, 
			fileName,
			rawData: parsedData
		};
	} catch (error: any) {
		console.error('Ошибка в processDocument:', error);
		try {
			await ctx.reply(
				`❌ Ошибка при анализе файла: ${error.message || 'Неизвестная ошибка'}`
			);
		} catch (replyError) {
			console.error('Ошибка при отправке сообщения об ошибке:', replyError);
		}
		return null;
	}
}
