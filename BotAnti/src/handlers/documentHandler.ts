import { Bot, Context } from 'grammy';
import { BOT_TOKEN } from '../config.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

export interface MessageData {
	author: string;
	text: string;
	userId?: string | number; // ID пользователя (если доступен)
}

export interface ProcessedDocument {
	messages: MessageData[];
	fileName: string;
}

function parseJsonMessages(data: any): MessageData[] {
	const messages: MessageData[] = [];
	if (!Array.isArray(data.messages)) return messages;

	for (const msg of data.messages) {
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
			// Извлекаем user_id из различных возможных полей
			let userId: string | number | undefined;
			if (msg.from_id) {
				// Может быть from_id как строка или объект
				if (typeof msg.from_id === 'string' || typeof msg.from_id === 'number') {
					userId = msg.from_id;
				} else if (msg.from_id.user_id) {
					userId = msg.from_id.user_id;
				} else if (msg.from_id.channel_id) {
					userId = msg.from_id.channel_id;
				}
			} else if (msg.from_id_user_id) {
				userId = msg.from_id_user_id;
			}

			messages.push({ 
				author: msg.from, 
				text: text.trim(),
				userId: userId
			});
		}
	}
	return messages;
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

		const messages = fileName.endsWith('.json')
			? parseJsonMessages(JSON.parse(bodyStr))
			: parseHtmlMessages(bodyStr);

		if (messages.length === 0) {
			await ctx.reply('⚠️ Не удалось извлечь сообщения из файла.');
			return null;
		}

		return { messages, fileName };
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
