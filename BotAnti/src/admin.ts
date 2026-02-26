import { Bot, InlineKeyboard, Context } from 'grammy';
import { ADMINS, PROFANITY_WORDS, AD_KEYWORDS } from './config.js';
import { dbPromise, addWord, deleteWord, getWords, setSetting } from './db.js';
import {
	updateProfanity,
	updateAd,
	updateCustom,
	profanityWords,
	adWords,
	customWords,
} from './filters.js';
import {
	FILTER_PROFANITY,
	FILTER_ADVERTISING,
	USE_NEURAL_NETWORK,
	DELETE_MESSAGES,
	toggleProfanity,
	toggleAdvertising,
	toggleNeuralNetwork,
	toggleDeleteMessages,
	getCurrentModel,
	setCurrentModel,
} from './state.js';

import {
	analyzeAllTopics,
	AVAILABLE_MODELS,
	getActiveTopics,
	toggleTopic,
	TOPICS,
	getTopicsByPriority,
} from './neural.js';
import {
	topicCreationStates,
	setTopicCreationState,
	getTopicCreationState,
	TopicCreationState,
} from './state.js';

export async function initAdminDB() {
	const profanity = await getWords('profanity_words');
	const ad = await getWords('ad_keywords');
	const custom = await getWords('custom_words');

	if (profanity.length === 0 && PROFANITY_WORDS.length > 0) {
		for (const word of PROFANITY_WORDS) await addWord('profanity_words', word);
	}
	if (ad.length === 0 && AD_KEYWORDS.length > 0) {
		for (const word of AD_KEYWORDS) await addWord('ad_keywords', word);
	}

	updateProfanity(await getWords('profanity_words'));
	updateAd(await getWords('ad_keywords'));
	updateCustom(await getWords('custom_words'));
	const db = await dbPromise;
	const rows = await db.all(
		`SELECT name, system_prompt, priority, enabled FROM topics`
	);

	for (const row of rows) {
		if (!TOPICS.find(t => t.name === row.name)) {
			TOPICS.push({
				name: row.name,
				systemPrompt: row.system_prompt,
				keywords: [],
				priority: row.priority,
				enabled: !!row.enabled,
			});
		}
	}

	console.log(`🧠 Загружено тем из БД: ${rows.length}`);
}

function mainAdminKeyboard() {
	const currentModel = getCurrentModel();
	const shortModel = currentModel.split(':')[0];

	return new InlineKeyboard()

		.text(`${DELETE_MESSAGES ? '✅' : '❌'} Удаление`, 'toggle_delete')
		.row()
		.text(`${FILTER_PROFANITY ? '✅' : '❌'} Брань`, 'toggle_profanity')
		.row()
		.text(`${FILTER_ADVERTISING ? '✅' : '❌'} Реклама`, 'toggle_ad')
		.row()
		.text(`${USE_NEURAL_NETWORK ? '✅' : '❌'} Нейросеть`, 'toggle_neural')
		.row()
		.text(`🤖 ${shortModel}`, 'neural_models')
		.row()
		.text('🧠 Темы нейросети', 'neural_topics')
		.row()
		.text('📊 Статистика', 'show_statistics')
		.row()
		.text('📝 Список слов', 'list_words')
		.row()
		.text('📜 Команды', 'show_commands');
}

function backToAdminKeyboard() {
	return new InlineKeyboard().text('⬅️ Назад в панель', 'back_to_admin');
}

function neuralModelsKeyboard() {
	const keyboard = new InlineKeyboard();
	const currentModel = getCurrentModel();

	AVAILABLE_MODELS.forEach((model, index) => {
		const isCurrent = model === currentModel;
		const shortName = model.split(':')[0];

		const modelId = model.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
		const callbackData = `model_${modelId}`;

		keyboard.text(`${isCurrent ? '✅' : '🔘'} ${shortName}`, callbackData);
		if (index % 2 === 1) keyboard.row();
	});

	keyboard.row().text('⬅️ Назад', 'back_to_admin');
	return keyboard;
}

function neuralTopicsKeyboard() {
	const keyboard = new InlineKeyboard();
	const sortedTopics = getTopicsByPriority();

	sortedTopics.forEach(topic => {
		const label = `${topic.enabled ? '✅' : '❌'} ${topic.name} (${
			topic.priority
		})`;
		const callbackData = `topic_${topic.name}`;
		const deleteCallbackData = `delete_topic_${topic.name}`;

		keyboard.text(label, callbackData);
		keyboard.text('🗑️', deleteCallbackData);
		keyboard.row();
	});

	keyboard.row().text('➕ Добавить топик', 'add_topic_button');
	keyboard.row().text('⬅️ Назад', 'back_to_admin');
	return keyboard;
}

export function registerAdminPanel(bot: Bot<Context>) {
	bot.command('start', async ctx => {
		if (ctx.from && ADMINS.includes(ctx.from.id)) {
			await ctx.reply('👋 Бот запущен. Открой панель: /admin', {
				reply_markup: mainAdminKeyboard(),
			});
		} else {
			await ctx.reply('Бот запущен. Админ-панель: /admin');
		}
	});

	bot.command('admin', async ctx => {
		if (!ctx.from || !ADMINS.includes(ctx.from.id)) return;
		if (!ctx.chat || ctx.chat.type !== 'private') {
			return ctx.reply('⚠️ Админ-панель доступна только в личке с ботом');
		}

		await ctx.reply('📋 Панель администратора', {
			reply_markup: mainAdminKeyboard(),
		});
	});

	bot.on('callback_query:data', async (ctx, next) => {
		const data = ctx.callbackQuery?.data;

		if (!ctx.from || !ADMINS.includes(ctx.from.id)) {
			return next();
		}

		if (!data) {
			return next();
		}

		const adminCallbacks = [
			'toggle_delete',
			'toggle_profanity',
			'toggle_ad',
			'toggle_neural',
			'neural_models',
			'show_statistics',
			'list_words',
			'show_commands',
			'back_to_admin',
			'neural_topics',
			'add_topic_button',
			'cancel_add_topic',
			'confirm_delete_topic',
			'cancel_delete_topic',
		];
		const isAdminCallback =
			adminCallbacks.includes(data) ||
			data.startsWith('topic_') ||
			data.startsWith('delete_topic_') ||
			data.startsWith('confirm_delete_topic_') ||
			data.startsWith('model_');

		if (!isAdminCallback) {
			return next();
		}

		const db = await dbPromise;

		switch (data) {
			case 'toggle_delete': {
				const v = toggleDeleteMessages();
				await setSetting('DELETE_MESSAGES', v ? '1' : '0');
				await ctx.editMessageText(
					`Фильтр удаления: ${v ? '✅ Вкл' : '❌ Выкл'}`,
					{ reply_markup: backToAdminKeyboard() }
				);
				break;
			}
			case 'toggle_profanity': {
				const v = toggleProfanity();
				await setSetting('FILTER_PROFANITY', v ? '1' : '0');
				await ctx.editMessageText(
					`Фильтр брани: ${v ? '✅ Вкл' : '❌ Выкл'}`,
					{ reply_markup: backToAdminKeyboard() }
				);
				break;
			}
			case 'toggle_ad': {
				const v = toggleAdvertising();
				await setSetting('FILTER_ADVERTISING', v ? '1' : '0');
				await ctx.editMessageText(
					`Фильтр рекламы: ${v ? '✅ Вкл' : '❌ Выкл'}`,
					{ reply_markup: backToAdminKeyboard() }
				);
				break;
			}
			case 'toggle_neural': {
				const v = toggleNeuralNetwork();
				await setSetting('USE_NEURAL_NETWORK', v ? '1' : '0');
				await ctx.editMessageText(
					`Нейросеть: ${v ? '✅ Вкл' : '❌ Выкл'}`,
					{ reply_markup: backToAdminKeyboard() }
				);
				break;
			}

			case 'neural_models':
				const currentModel = getCurrentModel();
				await ctx.editMessageText(
					`🤖 Выбор модели нейросети:\n\nТекущая модель: ${currentModel}\n\nВыберите модель:`,
					{ reply_markup: neuralModelsKeyboard() }
				);
				break;

			case 'show_statistics': {
				const now = Math.floor(Date.now() / 1000);
				const oneHourAgo = now - 3600;
				const oneWeekAgo = now - 7 * 24 * 3600;
				const getCount = async (q: string, p: any[] = []) =>
					((await db.get(q, p)) as { c: number } | undefined)?.c ?? 0;

				const lastHour = await getCount(
					'SELECT COUNT(*) as c FROM statistics WHERE timestamp > ?',
					[oneHourAgo]
				);
				const lastWeek = await getCount(
					'SELECT COUNT(*) as c FROM statistics WHERE timestamp > ?',
					[oneWeekAgo]
				);
				const allTime = await getCount('SELECT COUNT(*) as c FROM statistics');
				const violationsAll = await getCount(
					"SELECT COUNT(*) as c FROM statistics WHERE type IN ('violation_ad','violation_profanity','violation_custom','neural_bad_words','neural_cars','neural_advertising')"
				);
				const neuralViolations = await getCount(
					"SELECT COUNT(*) as c FROM statistics WHERE type LIKE 'neural_%'"
				);

				await ctx.editMessageText(
					`📊 Статистика:\nПоследний час: ${lastHour}\nПоследняя неделя: ${lastWeek}\nВсего: ${allTime} (нарушений: ${violationsAll})\n🧠 Нарушений нейросети: ${neuralViolations}`,
					{ reply_markup: backToAdminKeyboard() }
				);
				break;
			}

			case 'list_words':
				const activeTopicsList = getActiveTopics();
				const neuralInfo =
					activeTopicsList.length > 0
						? activeTopicsList
								.map(t => `${t.name} (приоритет: ${t.priority})`)
								.join('\n')
						: 'нет активных тематик';

				await ctx.editMessageText(
					`📝 Список слов:\n🚫 Брань: ${
						[...profanityWords].join(', ') || 'нет'
					}\n📢 Реклама: ${
						[...adWords].join(', ') || 'нет'
					}\n🧩 Пользовательские: ${
						[...customWords].join(', ') || 'нет'
					}\n\n🧠 Тематики нейросети:\n${neuralInfo}`,
					{ reply_markup: backToAdminKeyboard() }
				);
				break;

			case 'show_commands':
				await ctx.editMessageText(
					`📜 Команды администратора:\n\n` +
						`/admin - панель управления\n` +
						`/check_chat - анализ ЛС\n` +
						`/test_neural <текст> - тест нейросети\n` +
						`/models - список моделей\n` +
						`/neural_stats - статистика нейросети\n\n` +
						`📝 Управление словами:\n` +
						`/add_profanity <слово>\n` +
						`/del_profanity <слово>\n` +
						`/add_ad <слово>\n` +
						`/del_ad <слово>\n` +
						`/add_custom <слово>\n` +
						`/del_custom <слово>\n\n` +
						`🗂️ Управление темами:\n` +
						`/add_topic <имя> | <описание> | <приоритет> | <свой prompt>\n` +
						`/del_topic <имя>`,

					{ reply_markup: backToAdminKeyboard() }
				);
				break;

			case 'back_to_admin':
				await ctx.editMessageText('📋 Панель администратора', {
					reply_markup: mainAdminKeyboard(),
				});
				break;
			case 'neural_topics': {
				const sortedTopics = getTopicsByPriority();
				if (sortedTopics.length === 0) {
					const keyboard = new InlineKeyboard()
						.text('➕ Добавить топик', 'add_topic_button')
						.row()
						.text('⬅️ Назад', 'back_to_admin');
					await ctx.editMessageText(
						'🧠 В базе пока нет тематик. Добавь их через кнопку ниже или команду /add_topic.',
						{ reply_markup: keyboard }
					);
					break;
				}

				let topicsText = '🧠 Управление тематиками:\n\n';
				for (const t of sortedTopics) {
					topicsText += `• <b>${t.name}</b> (${t.priority})\n`;
					topicsText += `   ${t.enabled ? '✅ Включена' : '❌ Выключена'}\n`;
					topicsText += `   <i>${t.systemPrompt.slice(0, 120)}${
						t.systemPrompt.length > 120 ? '…' : ''
					}</i>\n\n`;
				}

				await ctx.editMessageText(topicsText, {
					parse_mode: 'HTML',
					reply_markup: neuralTopicsKeyboard(),
				});
				break;
			}

			case 'add_topic_button': {
				if (!ctx.from) break;
				setTopicCreationState(ctx.from.id, { step: 'name' });
				const cancelKeyboard = new InlineKeyboard().text(
					'❌ Отмена',
					'cancel_add_topic'
				);
				await ctx.editMessageText(
					'➕ Добавление новой тематики\n\n📝 Шаг 1/4: Введите имя тематики:',
					{ reply_markup: cancelKeyboard }
				);
				break;
			}

			case 'cancel_add_topic': {
				if (!ctx.from) break;
				setTopicCreationState(ctx.from.id, null);
				await ctx.editMessageText('❌ Добавление топика отменено.', {
					reply_markup: backToAdminKeyboard(),
				});
				break;
			}

			default:
				if (data.startsWith('delete_topic_')) {
					const topicName = data.replace('delete_topic_', '');
					const topic = TOPICS.find(t => t.name === topicName);
					if (topic) {
						const confirmKeyboard = new InlineKeyboard()
							.text('✅ Да, удалить', `confirm_delete_topic_${topicName}`)
							.text('❌ Отмена', 'cancel_delete_topic')
							.row()
							.text('⬅️ Назад к темам', 'neural_topics');

						await ctx.editMessageText(
							`🗑️ Подтверждение удаления\n\n` +
								`Вы уверены, что хотите удалить тематику <b>"${topicName}"</b>?\n\n` +
								`<b>Описание:</b> ${topic.systemPrompt.slice(0, 150)}${
									topic.systemPrompt.length > 150 ? '…' : ''
								}\n\n` +
								`⚠️ Это действие нельзя отменить!`,
							{
								parse_mode: 'HTML',
								reply_markup: confirmKeyboard,
							}
						);
					}
				} else if (data.startsWith('confirm_delete_topic_')) {
					const topicName = data.replace('confirm_delete_topic_', '');
					const topic = TOPICS.find(t => t.name === topicName);

					if (!topic) {
						await ctx.answerCallbackQuery({
							text: 'Тематика не найдена',
							show_alert: true,
						});
						return;
					}

					const db = await dbPromise;
					const result = await db.run(`DELETE FROM topics WHERE name = ?`, [
						topicName,
					]);

					const index = TOPICS.findIndex(t => t.name === topicName);
					if (index !== -1) {
						TOPICS.splice(index, 1);
					}

					if ((result.changes ?? 0) > 0) {
						await ctx.editMessageText(
							`✅ Тематика "${topicName}" успешно удалена!`,
							{ reply_markup: neuralTopicsKeyboard() }
						);
					} else {
						await ctx.editMessageText(
							`⚠️ Тематика "${topicName}" не найдена в базе, но удалена из памяти.`,
							{ reply_markup: neuralTopicsKeyboard() }
						);
					}
				} else if (data === 'cancel_delete_topic') {
					await ctx.editMessageText('❌ Удаление отменено.', {
						reply_markup: neuralTopicsKeyboard(),
					});
				} else if (data.startsWith('topic_')) {
					const topicName = data.replace('topic_', '');
					const topic = TOPICS.find(t => t.name === topicName);
					if (topic) {
						const newState = !topic.enabled;
						const success = await toggleTopic(topicName, newState);

						if (success) {
							await ctx.editMessageText(
								`🧠 Тематика "${topicName}" теперь ${
									newState ? '✅ Включена' : '❌ Выключена'
								}.\n\n` +
									`<b>Prompt:</b>\n${topic.systemPrompt.slice(0, 200)}${
										topic.systemPrompt.length > 200 ? '…' : ''
									}`,
								{
									parse_mode: 'HTML',
									reply_markup: neuralTopicsKeyboard(),
								}
							);
						} else {
							await ctx.answerCallbackQuery({
								text: 'Ошибка при обновлении темы 😕',
								show_alert: true,
							});
						}
					}
				}

				if (data.startsWith('model_')) {
					const modelId = data.replace('model_', '');

					const model = AVAILABLE_MODELS.find(
						m => m.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30) === modelId
					);

					if (model) {
						setCurrentModel(model);
						await setSetting('CURRENT_MODEL', model);
						await ctx.editMessageText(`✅ Модель изменена на: ${model}`, {
							reply_markup: neuralModelsKeyboard(),
						});
					} else {
						await ctx.answerCallbackQuery({
							text: 'Модель не найдена',
							show_alert: true,
						});
					}
				}
				break;
		}

		await ctx.answerCallbackQuery();
	});

	bot.command('neural_stats', async ctx => {
		if (!ctx.from || !ADMINS.includes(ctx.from.id)) return;

		const activeTopics = getActiveTopics();
		const inactiveTopics = TOPICS.filter(topic => !topic.enabled);
		const currentModel = getCurrentModel();

		const statsText = activeTopics
			.map(topic => `• ${topic.name}: ✅ (приоритет: ${topic.priority})`)
			.join('\n');

		const inactiveText = inactiveTopics
			.map(topic => `• ${topic.name}: ❌`)
			.join('\n');

		await ctx.reply(
			`🧠 Статистика нейросети:\n\n` +
				`Модель: ${currentModel}\n` +
				`Состояние: ${USE_NEURAL_NETWORK ? '✅ Активна' : '❌ Выключена'}\n\n` +
				`Активные тематики:\n${statsText}\n\n` +
				`Неактивные тематики:\n${inactiveText || 'нет'}`
		);
	});

	bot.command('test_neural', async ctx => {
		if (!ctx.from || !ADMINS.includes(ctx.from.id)) return;

		const text = ctx.message?.text?.split(' ').slice(1).join(' ');
		if (!text) {
			return ctx.reply('❌ Укажите текст: /test_neural ваш текст');
		}

		await ctx.reply(`🧠 Тестирую нейросеть с текстом: "${text}"`);

		try {
			const results = await analyzeAllTopics(text);

			let response = `📊 Результаты анализа:\n\n`;

			results.forEach(result => {
				response += `• ${result.topic}: ${
					result.detected ? '🚨 ДА' : '✅ НЕТ'
				}\n`;
				if (result.reason) {
					response += `  Ответ: ${result.reason}\n`;
				}
				response += '\n';
			});

			await ctx.reply(response);
		} catch (error: any) {
			await ctx.reply(`❌ Ошибка: ${error.message}`);
		}
	});

	bot.command('models', async ctx => {
		if (!ctx.from || !ADMINS.includes(ctx.from.id)) return;

		const currentModel = getCurrentModel();
		let response = `🤖 Доступные модели:\n\n`;

		AVAILABLE_MODELS.forEach(model => {
			response += `${model === currentModel ? '✅' : '🔘'} ${model}\n`;
		});

		response += `\nТекущая: ${currentModel}\n`;
		response += `Изменить: /admin → "Модели"`;

		await ctx.reply(response);
	});

	['profanity', 'ad'].forEach(type => {
		const table = type === 'profanity' ? 'profanity_words' : 'ad_keywords';

		bot.command(`add_${type}`, async ctx => {
			if (!ctx.from || !ADMINS.includes(ctx.from.id)) return;

			const text = ctx.message?.text;
			if (!text) return ctx.reply(`❌ Укажи слово: /add_${type} слово`);

			const word = text.split(' ').slice(1).join(' ').toLowerCase();
			if (!word) return ctx.reply(`❌ Укажи слово: /add_${type} слово`);

			await addWord(table, word);
			type === 'profanity'
				? updateProfanity(await getWords(table))
				: updateAd(await getWords(table));

			await ctx.reply(`✅ Добавлено слово: ${word}`);
		});

		bot.command(`del_${type}`, async ctx => {
			if (!ctx.from || !ADMINS.includes(ctx.from.id)) return;

			const text = ctx.message?.text;
			if (!text) return ctx.reply(`❌ Укажи слово: /del_${type} слово`);

			const word = text.split(' ').slice(1).join(' ').toLowerCase();
			if (!word) return ctx.reply(`❌ Укажи слово: /del_${type} слово`);

			await deleteWord(table, word);
			type === 'profanity'
				? updateProfanity(await getWords(table))
				: updateAd(await getWords(table));

			await ctx.reply(`✅ Удалено слово: ${word}`);
		});
	});

	bot.command('add_custom', async ctx => {
		if (!ctx.from || !ADMINS.includes(ctx.from.id)) return;

		const text = ctx.message?.text;
		if (!text) return ctx.reply('❌ Укажи слово: /add_custom слово');

		const word = text.split(' ').slice(1).join(' ').toLowerCase();
		if (!word) return ctx.reply('❌ Укажи слово: /add_custom слово');

		await addWord('custom_words', word);
		updateCustom(await getWords('custom_words'));
		await ctx.reply(`✅ Добавлено слово в фильтр: ${word}`);
	});

	bot.command('del_custom', async ctx => {
		if (!ctx.from || !ADMINS.includes(ctx.from.id)) return;

		const text = ctx.message?.text;
		if (!text) return ctx.reply('❌ Укажи слово: /del_custom слово');

		const word = text.split(' ').slice(1).join(' ').toLowerCase();
		if (!word) return ctx.reply('❌ Укажи слово: /del_custom слово');

		await deleteWord('custom_words', word);
		updateCustom(await getWords('custom_words'));
		await ctx.reply(`✅ Удалено слово из фильтра: ${word}`);
	});
	bot.command('add_topic', async ctx => {
		if (!ctx.from || !ADMINS.includes(ctx.from.id)) return;

		const text = ctx.message?.text;
		if (!text)
			return ctx.reply(
				'❌ Укажи данные: /add_topic <имя> | <описание> | <приоритет> | <свой prompt>'
			);

		const parts = text.split('|').map(p => p.trim());
		if (parts.length < 3) {
			return ctx.reply(
				'❌ Формат: /add_topic <имя> | <описание> | <приоритет> | <свой prompt>'
			);
		}

		const [nameRaw, description, priorityRaw, customPrompt] = parts;
		const name = nameRaw.split(' ')[1]?.toLowerCase() || nameRaw.toLowerCase();
		const priority = parseInt(priorityRaw, 10);

		if (!name || !description || isNaN(priority)) {
			return ctx.reply(
				'❌ Формат: /add_topic <имя> | <описание> | <приоритет> | <свой prompt>'
			);
		}

		if (TOPICS.find(t => t.name === name)) {
			return ctx.reply(`⚠️ Тематика "${name}" уже существует.`);
		}

		const db = await dbPromise;

		await db.run(`
		CREATE TABLE IF NOT EXISTS topics (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT UNIQUE,
			description TEXT,
			system_prompt TEXT,
			priority INTEGER,
			enabled INTEGER DEFAULT 1
		)
	`);

		const systemPrompt = customPrompt
			? customPrompt
			: `Ты — анализатор темы "${name}". 
Твоя задача — определить, относится ли сообщение к следующему описанию:
${description}

Если относится — ответь "ДА", если нет — ответь "НЕТ".`;

		await db.run(
			`INSERT OR REPLACE INTO topics (name, description, system_prompt, priority, enabled)
	 VALUES (?, ?, ?, ?, 1)`,
			[name, description, systemPrompt, priority]
		);

		TOPICS.push({
			name,
			systemPrompt,
			keywords: [],
			priority,
			enabled: true,
		});

		await ctx.reply(
			`✅ Добавлена новая тематика нейросети:\n\n` +
				`• Название: ${name}\n` +
				`• Приоритет: ${priority}\n` +
				`• Описание: ${description}`
		);
	});

	bot.command('del_topic', async ctx => {
		if (!ctx.from || !ADMINS.includes(ctx.from.id)) return;

		const text = ctx.message?.text;
		if (!text) return ctx.reply('❌ Укажи имя темы: /del_topic <имя>');

		const name = text.split(' ')[1]?.trim()?.toLowerCase();
		if (!name) return ctx.reply('❌ Укажи имя темы: /del_topic <имя>');

		const db = await dbPromise;

		const result = await db.run(`DELETE FROM topics WHERE name = ?`, [name]);

		const index = TOPICS.findIndex(t => t.name === name);
		if (index === -1) {
			return ctx.reply(`⚠️ Тематика "${name}" не найдена.`);
		}

		TOPICS.splice(index, 1);

		if ((result.changes ?? 0) > 0) {
			await ctx.reply(`🗑 Тематика "${name}" удалена из базы и памяти.`);
		} else {
			await ctx.reply(
				`⚠️ Тематика "${name}" не найдена в базе, но удалена из памяти.`
			);
		}
	});

	bot.on('message', async (ctx, next) => {
		if (!ctx.from || !ADMINS.includes(ctx.from.id)) {
			return next();
		}

		if (ctx.chat.type !== 'private') {
			return next();
		}

		if (ctx.message?.text?.startsWith('/')) {
			return next();
		}

		if (ctx.message?.document) {
			return next();
		}

		const state = getTopicCreationState(ctx.from.id);
		if (!state) {
			return next();
		}

		const text = ctx.message?.text || ctx.message?.caption || '';
		if (!text.trim()) {
			await ctx.reply('❌ Пожалуйста, введите текст.');
			return;
		}

		const cancelKeyboard = new InlineKeyboard().text(
			'❌ Отмена',
			'cancel_add_topic'
		);

		switch (state.step) {
			case 'name': {
				const name = text.trim().toLowerCase();
				if (TOPICS.find(t => t.name === name)) {
					await ctx.reply(
						`⚠️ Тематика "${name}" уже существует. Введите другое имя:`,
						{ reply_markup: cancelKeyboard }
					);
					return;
				}
				setTopicCreationState(ctx.from.id, {
					...state,
					name,
					step: 'description',
				});
				await ctx.reply(
					'✅ Имя сохранено!\n\n📝 Шаг 2/4: Введите описание тематики:',
					{ reply_markup: cancelKeyboard }
				);
				break;
			}

			case 'description': {
				setTopicCreationState(ctx.from.id, {
					...state,
					description: text.trim(),
					step: 'prompt',
				});
				await ctx.reply(
					'✅ Описание сохранено!\n\n📝 Шаг 3/4: Введите промт для нейросети:',
					{ reply_markup: cancelKeyboard }
				);
				break;
			}

			case 'prompt': {
				setTopicCreationState(ctx.from.id, {
					...state,
					prompt: text.trim(),
					step: 'priority',
				});
				await ctx.reply(
					'✅ Промт сохранён!\n\n📝 Шаг 4/4: Введите приоритет (число, например: 1):',
					{ reply_markup: cancelKeyboard }
				);
				break;
			}

			case 'priority': {
				const priority = parseInt(text.trim(), 10);
				if (isNaN(priority) || priority < 1) {
					await ctx.reply(
						'❌ Приоритет должен быть числом больше 0. Введите приоритет:',
						{ reply_markup: cancelKeyboard }
					);
					return;
				}

				const { name, description, prompt } = state;
				if (!name || !description) {
					await ctx.reply(
						'❌ Ошибка: не все данные заполнены. Начните заново.'
					);
					setTopicCreationState(ctx.from.id, null);
					return;
				}

				const db = await dbPromise;

				await db.run(`
					CREATE TABLE IF NOT EXISTS topics (
						id INTEGER PRIMARY KEY AUTOINCREMENT,
						name TEXT UNIQUE,
						description TEXT,
						system_prompt TEXT,
						priority INTEGER,
						enabled INTEGER DEFAULT 1
					)
				`);

				const systemPrompt =
					prompt ||
					`Ты — анализатор темы "${name}". 
Твоя задача — определить, относится ли сообщение к следующему описанию:
${description}

Если относится — ответь "ДА", если нет — ответь "НЕТ".`;

				await db.run(
					`INSERT OR REPLACE INTO topics (name, description, system_prompt, priority, enabled)
					 VALUES (?, ?, ?, ?, 1)`,
					[name, description, systemPrompt, priority]
				);

				TOPICS.push({
					name,
					systemPrompt,
					keywords: [],
					priority,
					enabled: true,
				});

				setTopicCreationState(ctx.from.id, null);

				await ctx.reply(
					`✅ Тематика успешно добавлена!\n\n` +
						`• Название: ${name}\n` +
						`• Описание: ${description}\n` +
						`• Приоритет: ${priority}\n` +
						`• Промт: ${systemPrompt.slice(0, 100)}${
							systemPrompt.length > 100 ? '...' : ''
						}`,
					{ reply_markup: backToAdminKeyboard() }
				);
				break;
			}
		}
	});
}
