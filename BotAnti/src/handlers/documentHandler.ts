import { Bot, Context } from 'grammy';
import { BOT_TOKEN } from '../config.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

export interface MessageData {
	author: string;
	text: string;
	userId?: string | number; // ID пользователя (если доступен)
}

export interface UserInfo {
	userId: string;
	name: string;
}

export interface ProcessedDocument {
	messages: MessageData[];
	fileName: string;
	rawData?: any; // Сохраняем сырые данные для извлечения пользователей
}

// Функция для извлечения user_id из сообщения
function extractUserIdFromMessage(msg: any): string | number | undefined {
	// Для сообщений типа "service" (служебные действия) - actor_id
	if (msg.type === 'service' && msg.actor_id) {
		if (typeof msg.actor_id === 'string' || typeof msg.actor_id === 'number') {
			return msg.actor_id;
		} else if (msg.actor_id.user_id) {
			return msg.actor_id.user_id;
		}
	}

	// Для сообщений типа "message" - from_id
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
		// Пропускаем service сообщения без текста, но извлекаем user_id для них
		if (msg.type === 'service') {
			const userId = extractUserIdFromMessage(msg);
			if (userId && msg.actor) {
				// Если есть текст в service сообщении, создаем сообщение
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

// Функция для нормализации user_id в формат "user123456"
function normalizeUserId(userId: string | number | undefined): string | null {
	if (userId === undefined || userId === null) return null;
	
	const userIdStr = String(userId);
	// Если уже в формате "user123456", оставляем как есть
	if (userIdStr.startsWith('user')) {
		return userIdStr;
	}
	// Иначе добавляем префикс "user"
	// Извлекаем только цифры на случай, если есть другие символы
	const numericMatch = userIdStr.match(/\d+/);
	if (numericMatch) {
		return `user${numericMatch[0]}`;
	}
	return null;
}

// Функция для извлечения уникальных пользователей из JSON файла
export function extractUniqueUsers(data: any): UserInfo[] {
	const usersMap = new Map<string, UserInfo>();
	if (!Array.isArray(data.messages)) return [];

	// Сначала собираем всех пользователей из сообщений
	for (const msg of data.messages) {
		let userId: string | number | undefined;
		let userName: string | undefined;

		// Для service сообщений
		if (msg.type === 'service') {
			userId = extractUserIdFromMessage(msg);
			userName = msg.actor || msg.from;
		}
		// Для обычных сообщений
		else if (msg.type === 'message' || !msg.type) {
			userId = extractUserIdFromMessage(msg);
			userName = msg.from;
		}

		// Добавляем пользователя из сообщения
		if (userId) {
			const normalizedId = normalizeUserId(userId);
			if (normalizedId && userName) {
				// Если пользователь уже есть, обновляем имя если оно было пустым
				const existing = usersMap.get(normalizedId);
				if (!existing || existing.name === 'Неизвестный пользователь') {
					usersMap.set(normalizedId, {
						userId: normalizedId,
						name: userName
					});
				}
			}
		}

		// Извлекаем user_id из reactions
		if (msg.reactions) {
			let recentReactions: any[] = [];

			// reactions может быть массивом объектов с полем recent
			if (Array.isArray(msg.reactions)) {
				for (const reaction of msg.reactions) {
					if (reaction.recent && Array.isArray(reaction.recent)) {
						recentReactions.push(...reaction.recent);
					}
					// Если сам элемент реакции имеет from_id
					if (reaction.from_id && !reaction.recent) {
						recentReactions.push(reaction);
					}
				}
			}
			// или reactions может быть объектом с полем recent
			else if (msg.reactions.recent && Array.isArray(msg.reactions.recent)) {
				recentReactions = msg.reactions.recent;
			}
			// или reactions может быть объектом с массивом recent в других местах
			else if (Array.isArray(msg.reactions)) {
				recentReactions = msg.reactions;
			}

			// Обрабатываем все найденные реакции
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
							// Если пользователь еще не добавлен, добавляем его
							if (!usersMap.has(normalizedId)) {
								// Попытаемся найти имя из других сообщений этого пользователя
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

		// Пытаемся извлечь user_id из data-атрибутов или других источников
		// В HTML экспорте Telegram может быть data-peer-id или другие атрибуты
		const peerId = $el.attr('data-peer-id') || 
		               $el.find('[data-peer-id]').first().attr('data-peer-id') ||
		               $el.attr('data-from-id');
		
		if (peerId) {
			// Убираем префикс "user" если есть (например "user123456789")
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
			rawData: parsedData // Сохраняем сырые данные для извлечения пользователей
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
