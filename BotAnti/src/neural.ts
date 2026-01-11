import axios from 'axios';
import { getCurrentModel } from './state.js';
import { dbPromise } from './db.js';

const NEURAL_API_URL = 'http://10.8.0.24:11434/v1/chat/completions';

const DEFAULT_PROMPT_CONDITION =
	'\n\nТвой ответ это твоя уверенность числом от 0 до 100, где 0 это в тексте нет упоминаний из категорий, а 100 в тексте точно есть что-то из категорий.';

export const AVAILABLE_MODELS = [
	'qwen2.5-coder:7b',
	'qwen3:30b',
	'hf.co/bartowski/Qwen_Qwen3-30B-A3B-Thinking-2507-GGUF:Q4_K_M',
	'hf.co/unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF:Q4_K_M',
];

interface NeuralApiResponse {
	choices?: Array<{
		message?: {
			content?: string;
		};
		finish_reason?: string;
	}>;
}

export interface TopicConfig {
	name: string;
	systemPrompt: string;
	keywords: string[];
	priority: number;
	enabled: boolean;
}

export const TOPICS: TopicConfig[] = [];

export interface NeuralResult {
	topic: string;
	detected: boolean;
	confidence?: number;
	reason?: string;
}

export async function analyzeWithNeural(
	message: string,
	topicName: string,
	signal?: AbortSignal
): Promise<NeuralResult> {
	try {
		const topic = TOPICS.find(t => t.name === topicName);
		if (!topic || !topic.enabled) {
			return { topic: topicName, detected: false };
		}
		const currentModel = getCurrentModel();
		console.log(
			`🧠 Запуск нейросети для темы "${topicName}":`,
			message.substring(0, 100)
		);

		const enhancedSystemPrompt = topic.systemPrompt + DEFAULT_PROMPT_CONDITION;

		const response = await axios.post(
			NEURAL_API_URL,
			{
				model: currentModel,
				messages: [
					{ role: 'system', content: enhancedSystemPrompt },
					{ role: 'user', content: `Сообщение для анализа: "${message}"` },
				],
				temperature: 0,
				max_tokens: 50,
			},
			{
				timeout: 15000,
				headers: { 'Content-Type': 'application/json' },
				...(signal ? { signal } : {}),
			} as any
		);

		const data = response.data as any;

		console.log('🧠 Полный ответ нейросети:', JSON.stringify(data, null, 2));

		let content: string | undefined;

		if (data.choices && Array.isArray(data.choices) && data.choices[0]) {
			content = data.choices[0]?.message?.content;
		} else if (data.response) {
			content = data.response;
		} else if (data.content) {
			content = data.content;
		} else {
			console.warn('Неизвестная структура ответа нейросети:', data);
			return { topic: topicName, detected: false };
		}

		if (!content) {
			console.warn('Нейросеть вернула пустой ответ');
			return { topic: topicName, detected: false };
		}

		const answer = content.trim();
		const numberMatch = answer.match(/-?\d+(?:[.,]\d+)?/);
		let confidence = numberMatch
			? Number.parseFloat(numberMatch[0].replace(',', '.'))
			: NaN;

		if (!Number.isFinite(confidence)) {
			console.warn(
				`Нейросеть вернула некорректное значение уверенности для темы "${topicName}":`,
				answer
			);
			confidence = 0;
		}

		confidence = Math.min(100, Math.max(0, confidence));
		const detected = confidence > 80;

		console.log(`🧠 Результат нейросети [${topicName}]:`, {
			answer: content,
			confidence,
			detected,
			finish_reason: data.choices?.[0]?.finish_reason,
		});

		return {
			topic: topicName,
			detected,
			confidence,
			reason: content,
		};
	} catch (error: any) {
		console.error(`Ошибка нейросети (${topicName}):`, error.message);

		if (error.response) {
			console.error('Детали ошибки:', error.response.data);
		}

		return {
			topic: topicName,
			detected: false,
			reason: 'API Error: ' + error.message,
		};
	}
}

export async function analyzeSequentially(
	message: string,
	signal?: AbortSignal
): Promise<NeuralResult | null> {
	const sortedTopics = [...TOPICS]
		.filter(topic => topic.enabled)
		.sort((a, b) => a.priority - b.priority);

	for (const topic of sortedTopics) {
		if (signal?.aborted) {
			throw new Error('cancelled');
		}
		const result = await analyzeWithNeural(message, topic.name, signal);

		if (result.detected) {
			console.log(
				`🚨 Обнаружено нарушение в теме ${topic.name}, остальные проверки пропускаются`
			);
			return result;
		}
	}

	return null;
}

export async function analyzeAllTopics(
	message: string
): Promise<NeuralResult[]> {
	const promises = TOPICS.filter(topic => topic.enabled).map(topic =>
		analyzeWithNeural(message, topic.name)
	);

	return Promise.all(promises);
}

export function getActiveTopics(): TopicConfig[] {
	return TOPICS.filter(topic => topic.enabled);
}

export async function toggleTopic(
	topicName: string,
	enabled: boolean
): Promise<boolean> {
	const topic = TOPICS.find(t => t.name === topicName);
	if (!topic) return false;

	topic.enabled = enabled;

	try {
		const db = await dbPromise;
		await db.run(`UPDATE topics SET enabled = ? WHERE name = ?`, [
			enabled ? 1 : 0,
			topicName,
		]);
		console.log(
			`🧠 Тематика "${topicName}" теперь ${enabled ? 'включена' : 'выключена'}`
		);
		return true;
	} catch (err) {
		console.error('Ошибка при обновлении темы в БД:', err);
		return false;
	}
}

export function getTopicsByPriority(): TopicConfig[] {
	return [...TOPICS].sort((a, b) => a.priority - b.priority);
}
