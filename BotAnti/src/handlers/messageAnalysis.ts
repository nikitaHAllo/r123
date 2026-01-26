import { Bot, Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import {
	FILTER_PROFANITY,
	FILTER_ADVERTISING,
	USE_NEURAL_NETWORK,
} from '../state.js';
import { checkProfanity, checkAd, checkCustom } from '../filters.js';
import { analyzeSequentially } from '../neural.js';
import { getViolationReason } from './violationHandler.js';
import { MessageData } from './documentHandler.js';

export interface ActiveAnalysis {
	cancel: boolean;
	controller: AbortController;
}

export interface PendingMessages {
	messages: MessageData[];
	fileName: string;
	authorFilter?: string; // Фильтр по имени автора
	rawData?: any; // Сырые данные JSON для извлечения пользователей
}

export const activeAnalyses = new Map<number, ActiveAnalysis>();
export const pendingMessages = new Map<number, PendingMessages>();

const UPDATE_INTERVAL = 1000;
const PROGRESS_UPDATE_FREQUENCY = 5;
const NEURAL_LOG_FREQUENCY = 100;
const MAX_MESSAGE_LENGTH = 4000;
const WARNING_DELETE_TIMEOUT = 10000;

type ViolationSource = 'neural' | 'profanity' | 'advertising' | 'custom';

interface DetectedViolation {
	index: number;
	author: string;
	text: string;
	violationType: string;
	source: ViolationSource;
	confidence?: number;
	topic?: string;
	reasonText?: string;
}

// ИСПРАВЛЕННАЯ функция экранирования для HTML
function escapeHtml(str = ''): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

function createCancelKeyboard(chatId: number): InlineKeyboard {
	return new InlineKeyboard().text('🛑 Отменить анализ', `cancel_${chatId}`);
}

async function updateProgress(
	ctx: Context,
	chatId: number,
	progressMessageId: number,
	current: number,
	total: number,
	startTime: number,
	lastUpdateTime: { value: number },
	cancelKeyboard: InlineKeyboard
) {
	const now = Date.now();
	if (now - lastUpdateTime.value < UPDATE_INTERVAL && current < total) {
		return;
	}
	lastUpdateTime.value = now;

	const elapsed = Math.floor((now - startTime) / 1000);
	const speed = elapsed > 0 && current > 0 ? Math.round(current / elapsed) : 0;
	const progressText =
		`🔍 Анализ в процессе...\n\n` +
		`📊 Проанализировано: ${current} из ${total}\n` +
		`⏱ Время: ${elapsed} секунд${
			speed > 0 ? `\n⚡ Скорость: ${speed} сообщ/сек` : ''
		}`;

	try {
		await ctx.api.editMessageText(chatId, progressMessageId, progressText, {
			reply_markup: cancelKeyboard,
		});
	} catch (err) {
		console.error('Ошибка обновления прогресса:', err);
	}
}

function checkCancelled(chatId: number): void {
	const analysis = activeAnalyses.get(chatId);
	if (!analysis || analysis.cancel) throw new Error('cancelled');
}

async function analyzeMessage(
	msg: MessageData,
	index: number,
	total: number,
	controller: AbortController,
	violationsReport: DetectedViolation[]
): Promise<string | null> {
	const text = msg.text.toLowerCase();
	let violation: string | null = null;
	let violationSource: ViolationSource | null = null;
	let confidence: number | undefined;
	let topic: string | undefined;
	let reasonText: string | undefined;

	if (USE_NEURAL_NETWORK && text.length > 3) {
		if (index === 0 || index % NEURAL_LOG_FREQUENCY === 0) {
			console.log(
				`🧠 [${
					index + 1
				}/${total}] Вызываю нейросеть для анализа: "${text.substring(
					0,
					50
				)}..."`
			);
		}
		try {
			const neuralViolation = await analyzeSequentially(
				text,
				controller.signal
			);
			if (neuralViolation && typeof neuralViolation === 'object') {
				console.log(
					`🚨 [${index + 1}] Нейросеть обнаружила нарушение: ${
						neuralViolation.topic
					}`
				);
				violation = `neural_${neuralViolation.topic}`;
				violationSource = 'neural';
				confidence =
					typeof neuralViolation.confidence === 'number'
						? Math.round(neuralViolation.confidence)
						: undefined;
				topic = neuralViolation.topic;
				reasonText = neuralViolation.reason;
			}
		} catch (err) {
			if (err instanceof Error && err.message === 'cancelled') {
				throw err;
			}
			console.error(
				`❌ Ошибка нейросети при анализе сообщения ${index + 1}:`,
				err
			);
		}
	}

	if (!violation) {
		if (FILTER_PROFANITY && checkProfanity(text))
			violation = 'violation_profanity';
		if (!violation && FILTER_ADVERTISING && checkAd(text))
			violation = 'violation_ad';
		if (!violation && checkCustom(text)) violation = 'violation_custom';

		if (violation) {
			if (violation === 'violation_profanity') {
				violationSource = 'profanity';
			} else if (violation === 'violation_ad') {
				violationSource = 'advertising';
			} else {
				violationSource = 'custom';
			}
		}
	}

	if (violation) {
		violationsReport.push({
			index: index + 1,
			author: msg.author,
			text: msg.text,
			violationType: violation,
			source: violationSource ?? 'custom',
			confidence,
			topic,
			reasonText,
		});
	}

	return violation;
}

// ИСПРАВЛЕННАЯ функция formatViolation для HTML
function formatViolation(violation: DetectedViolation): string {
	const header = `<b>${violation.index}.</b> 👤 <b>${escapeHtml(
		violation.author
	)}</b>`;
	const reason = `⚠️ <b>${escapeHtml(
		getViolationReason(violation.violationType)
	)}</b>`;
	const sourceLabel = (() => {
		switch (violation.source) {
			case 'neural':
				return `🧠 Источник: нейросеть${
					violation.topic ? ` (${escapeHtml(violation.topic)})` : ''
				}`;
			case 'profanity':
				return '🚫 Источник: фильтр брани';
			case 'advertising':
				return '📢 Источник: фильтр рекламы';
			default:
				return '🧩 Источник: кастомный фильтр';
		}
	})();
	const confidenceLine =
		typeof violation.confidence === 'number'
			? `📈 Уверенность: ${violation.confidence}%\n`
			: '';
	const reasonTextLine = violation.reasonText
		? `📝 Ответ нейросети: ${escapeHtml(violation.reasonText.slice(0, 200))}${
				violation.reasonText.length > 200 ? '…' : ''
		  }\n`
		: '';
	const messageLine = `💬 "${escapeHtml(violation.text)}"`;

	return (
		`${header}\n${reason}\n${sourceLabel}\n` +
		`${confidenceLine}${reasonTextLine}${messageLine}`
	).trim();
}

async function sendViolationsReport(
	ctx: Context,
	violationsReport: DetectedViolation[],
	fileName: string
): Promise<void> {
	if (violationsReport.length === 0) {
		await ctx.reply(`✅ В файле ${fileName} нарушений не найдено.`);
		return;
	}

	const chunkSize = MAX_MESSAGE_LENGTH;
	let chunkText = '';

	for (const violation of violationsReport) {
		const formatted = formatViolation(violation);
		if ((chunkText + '\n\n' + formatted).length > chunkSize) {
			await sendChunk(ctx, chunkText);
			chunkText = formatted;
		} else {
			chunkText += (chunkText ? '\n\n' : '') + formatted;
		}
	}

	if (chunkText) await sendChunk(ctx, chunkText);
}

// ИСПРАВЛЕННАЯ функция sendChunk с HTML форматированием
async function sendChunk(ctx: Context, text: string): Promise<void> {
	for (let i = 0; i < text.length; i += MAX_MESSAGE_LENGTH) {
		const chunk = text.slice(i, i + MAX_MESSAGE_LENGTH);

		try {
			// Текст уже экранирован в formatViolation через escapeHtml
			await ctx.reply(chunk, {
				parse_mode: 'HTML',
			});
		} catch (error) {
			console.error('Ошибка отправки с HTML:', error);

			// Пробуем отправить без форматирования
			try {
				await ctx.reply(chunk, {
					parse_mode: undefined,
				});
			} catch (secondError) {
				console.error('Ошибка отправки без форматирования:', secondError);

				// Если текст слишком длинный, разбиваем его по строкам
				const lines = chunk.split('\n');
				let currentChunk = '';

				for (const line of lines) {
					if ((currentChunk + line).length > MAX_MESSAGE_LENGTH) {
						if (currentChunk) {
							await ctx.reply(currentChunk, { parse_mode: undefined });
							currentChunk = line;
						} else {
							// Даже одна строка слишком длинная - режем её
							for (let j = 0; j < line.length; j += MAX_MESSAGE_LENGTH) {
								await ctx.reply(line.slice(j, j + MAX_MESSAGE_LENGTH), {
									parse_mode: undefined,
								});
							}
							currentChunk = '';
						}
					} else {
						currentChunk += (currentChunk ? '\n' : '') + line;
					}
				}

				if (currentChunk) {
					await ctx.reply(currentChunk, { parse_mode: undefined });
				}
			}
		}
	}
}

async function handleCancellation(
	ctx: Context,
	chatId: number,
	progressMessageId: number,
	index: number,
	total: number,
	startTime: number
): Promise<void> {
	const elapsed = Math.floor((Date.now() - startTime) / 1000);
	try {
		await ctx.api.editMessageText(
			chatId,
			progressMessageId,
			`🛑 Анализ прерван пользователем.\n\n📊 Проанализировано: ${index} из ${total}\n⏱ Время: ${elapsed} секунд`
		);
	} catch (err) {
		console.error('Ошибка обновления сообщения об отмене:', err);
	}
	activeAnalyses.delete(chatId);
}

// Функция для нормализации user_id к числовому формату (убираем префикс "user" если есть)
export function normalizeUserIdForComparison(userId: string | number | undefined): string | null {
	if (userId === undefined || userId === null) return null;
	
	const userIdStr = String(userId);
	// Если есть префикс "user", убираем его
	if (userIdStr.startsWith('user')) {
		return userIdStr.substring(4); // Убираем "user"
	}
	// Извлекаем только цифры
	const numericMatch = userIdStr.match(/\d+/);
	if (numericMatch) {
		return numericMatch[0];
	}
	return userIdStr;
}

export async function startAnalysis(
	ctx: Context,
	bot: Bot,
	chatId: number,
	messages: MessageData[],
	fileName: string,
	limit: number | null,
	totalFilesProcessed: number,
	onComplete?: () => void,
	authorFilter?: string // Фильтр по имени автора или user_id
) {
	// Сначала фильтруем по автору или user_id, если указан фильтр
	let filteredMessages = messages;
	if (authorFilter) {
		// Проверяем, является ли фильтр числом (user_id) или строкой (имя)
		const isNumeric = /^\d+$/.test(authorFilter.trim());
		
		if (isNumeric) {
			// Фильтруем по user_id - нормализуем фильтр (убираем "user" если есть)
			const userIdFilter = authorFilter.trim().replace(/^user/, '');
			filteredMessages = messages.filter(msg => {
				if (!msg.userId) return false;
				const normalizedMsgUserId = normalizeUserIdForComparison(msg.userId);
				return normalizedMsgUserId === userIdFilter;
			});
		} else {
			// Фильтруем по имени автора
			filteredMessages = messages.filter(msg =>
				msg.author.toLowerCase().includes(authorFilter.toLowerCase())
			);
		}
		
		if (filteredMessages.length === 0) {
			await ctx.reply(
				`⚠️ Не найдено сообщений по фильтру "${authorFilter}". Анализ отменён.`
			);
			return;
		}
	}

	const messagesToAnalyze =
		limit !== null ? filteredMessages.slice(0, limit) : filteredMessages;

	if (activeAnalyses.has(chatId)) {
		await ctx.reply(
			'⚠️ Анализ уже выполняется. Отмени его или дождись завершения.'
		);
		return;
	}

	const controller = new AbortController();
	activeAnalyses.set(chatId, { cancel: false, controller });
	const cancelKeyboard = createCancelKeyboard(chatId);

	const filterInfo = authorFilter
		? `\n👤 Фильтр по автору: "${authorFilter}" (найдено ${filteredMessages.length} сообщений)`
		: '';
	const startMessage = await ctx.reply(
		`🔍 Начинаю анализ ${messagesToAnalyze.length} из ${filteredMessages.length} сообщений...${filterInfo}\n\n📊 Проанализировано: 0 из ${messagesToAnalyze.length}\n⏱ Время: 0 секунд`,
		{
			reply_markup: cancelKeyboard,
		}
	);

	const startTime = Date.now();
	const progressMessageId = startMessage.message_id;
	const lastUpdateTime = { value: 0 };
	const violationsReport: DetectedViolation[] = [];

	for (const [index, msg] of messagesToAnalyze.entries()) {
		try {
			checkCancelled(chatId);
			await analyzeMessage(
				msg,
				index,
				messagesToAnalyze.length,
				controller,
				violationsReport
			);

			if (
				index % PROGRESS_UPDATE_FREQUENCY === 0 ||
				index === messagesToAnalyze.length - 1
			) {
				await updateProgress(
					ctx,
					chatId,
					progressMessageId,
					index + 1,
					messagesToAnalyze.length,
					startTime,
					lastUpdateTime,
					cancelKeyboard
				);
			}
		} catch (err) {
			if (err instanceof Error && err.message === 'cancelled') {
				await handleCancellation(
					ctx,
					chatId,
					progressMessageId,
					index,
					messagesToAnalyze.length,
					startTime
				);
				return;
			}
			console.error('Ошибка при обработке сообщения:', err);
		}
	}

	activeAnalyses.delete(chatId);
	const elapsed = Math.floor((Date.now() - startTime) / 1000);
	const speed =
		elapsed > 0
			? Math.round(messagesToAnalyze.length / elapsed)
			: messagesToAnalyze.length;

	try {
		await ctx.api.editMessageText(
			chatId,
			progressMessageId,
			`✅ Анализ завершён.\n\n📊 Проанализировано: ${messagesToAnalyze.length} из ${messagesToAnalyze.length}\n⏱ Время: ${elapsed} секунд\n⚡ Скорость: ${speed} сообщ/сек`
		);
	} catch (err) {
		console.error('Ошибка обновления финального сообщения:', err);
	}

	await sendViolationsReport(ctx, violationsReport, fileName);

	if (onComplete) onComplete();
}

export function createLimitKeyboard(
	chatId: number,
	authorFilter?: string
): InlineKeyboard {
	const callbackAll = `analyze_limit_${chatId}_all`;
	const callback500 = `analyze_limit_${chatId}_500`;
	const callback1000 = `analyze_limit_${chatId}_1000`;
	const callback2000 = `analyze_limit_${chatId}_2000`;
	const callback5000 = `analyze_limit_${chatId}_5000`;
	const callback10000 = `analyze_limit_${chatId}_10000`;
	const callbackCustom = `analyze_limit_${chatId}_custom`;
	const callbackAuthorFilter = `analyze_author_filter_${chatId}`;
	const callbackShowUsers = `show_users_${chatId}`;

	const keyboard = new InlineKeyboard()
		.text('📊 Все сообщения', callbackAll)
		.row()
		.text('500', callback500)
		.text('1000', callback1000)
		.row()
		.text('2000', callback2000)
		.text('5000', callback5000)
		.row()
		.text('10000', callback10000)
		.row()
		.text('✏️ Ввести число', callbackCustom)
		.row();
	
	// Всегда показываем кнопку поиска по имени на отдельной строке
	// Если фильтр установлен, показываем его на кнопке
	if (authorFilter) {
		keyboard.row().text(`👤 Фильтр: ${authorFilter}`, callbackAuthorFilter);
	} else {
		keyboard.row().text('👤 Поиск по имени', callbackAuthorFilter);
	}

	// Проверяем наличие rawData для показа кнопки списка пользователей
	const pending = pendingMessages.get(chatId);
	if (pending?.rawData) {
		keyboard.row().text('👥 Список пользователей', callbackShowUsers);
	}
	
	return keyboard;
}
