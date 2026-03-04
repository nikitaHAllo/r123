import dotenv from 'dotenv';
import axios from 'axios';
import type { IAiProvider, NeuralResult } from '../../core/ports/neuralNetwork.js';
import type { ILogger } from '../../core/ports/logger.js';

dotenv.config();

const DEFAULT_PROMPT_CONDITION =
	'\n\nТвой ответ это твоя уверенность числом от 0 до 100, где 0 это в тексте нет упоминаний из категорий, а 100 в тексте точно есть что-то из категорий.';

export const DEFAULT_OLLAMA_URL =
	process.env.OLLAMA_URL ||
	process.env.NEURAL_API_URL ||
	'http://10.8.0.24:11434/v1/chat/completions';

export interface OllamaAdapterOptions {
	baseUrl?: string;
	logger?: ILogger;
}

/**
 * Реализация IAiProvider для Ollama API.
 */
export function createOllamaAdapter(options: OllamaAdapterOptions = {}): IAiProvider {
	const baseUrl = options.baseUrl ?? DEFAULT_OLLAMA_URL;
	const logger = options.logger ?? { info: console.log, warn: console.warn, error: console.error, debug: console.debug };

	return {
		async analyze(message, topic, model, signal) {
			const topicName = topic.name;
			try {
				logger.info?.('Ollama: analyze', topicName, message.substring(0, 80));
				const enhancedSystemPrompt = topic.systemPrompt + DEFAULT_PROMPT_CONDITION;

				const response = await axios.post(
					baseUrl,
					{
						model,
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
				let content: string | undefined;

				if (data.choices?.[0]?.message?.content) {
					content = data.choices[0].message.content;
				} else if (data.response) {
					content = data.response;
				} else if (data.content) {
					content = data.content;
				} else {
					logger.warn?.('Ollama: unknown response shape', data);
					return { topic: topicName, detected: false };
				}

				if (!content?.trim()) {
					logger.warn?.('Ollama: empty content');
					return { topic: topicName, detected: false };
				}

				const answer = content.trim();
				const numberMatch = answer.match(/-?\d+(?:[.,]\d+)?/);
				let confidence = numberMatch
					? Number.parseFloat(numberMatch[0].replace(',', '.'))
					: NaN;

				if (!Number.isFinite(confidence)) {
					logger.warn?.('Ollama: invalid confidence', answer);
					confidence = 0;
				}
				confidence = Math.min(100, Math.max(0, confidence));
				const detected = confidence > 80;

				return {
					topic: topicName,
					detected,
					confidence,
					reason: content,
				};
			} catch (error: any) {
				logger.error?.('Ollama: error', topicName, error?.message);
				return {
					topic: topicName,
					detected: false,
					reason: 'API Error: ' + (error?.message ?? 'Unknown'),
				};
			}
		},
	};
}
