import type { Violation, ViolationType } from '../entities/index.js';
import type { ISettings, ILogger } from '../ports/index.js';
import type { IAiProvider, NeuralResult } from '../ports/neuralNetwork.js';
import type { FilterWords } from '../filters/keywordFilter.js';
import { detectKeywordViolation } from '../filters/keywordFilter.js';

export interface ModerateMessageInput {
	text: string;
	words: FilterWords;
	signal?: AbortSignal;
}

export interface ModerateMessageResult {
	violation: Violation | null;
	neuralResult?: NeuralResult | null;
}

/**
 * Сценарий: модерация одного сообщения.
 * Сначала нейросеть (если включена), затем фильтры по ключевым словам.
 */
export async function moderateMessage(
	input: ModerateMessageInput,
	deps: {
		settings: ISettings;
		ai: IAiProvider;
		topicsProvider: { getTopics: () => Array<{ name: string; enabled: boolean; systemPrompt: string; priority: number }> }; // Topic[]
		logger: ILogger;
	}
): Promise<ModerateMessageResult> {
	const { text, words, signal } = input;
	const { settings, ai, topicsProvider, logger } = deps;
	const lower = text.toLowerCase().trim();

	// 1. Нейросеть (если включена и текст не слишком короткий)
	if (settings.getUseNeuralNetwork() && lower.length > 3) {
		const topics = topicsProvider
			.getTopics()
			.filter((t) => t.enabled)
			.sort((a, b) => a.priority - b.priority);

		for (const topic of topics) {
			if (signal?.aborted) {
				throw new Error('cancelled');
			}
			try {
				const result = await ai.analyze(
					text,
					{ name: topic.name, systemPrompt: topic.systemPrompt },
					settings.getCurrentModel(),
					signal
				);
				if (result.detected) {
					logger.info?.('ModerateMessage: neural violation', topic.name);
					return {
						violation: {
							type: `neural_${result.topic}` as ViolationType,
							confidence: result.confidence,
							topic: result.topic,
							reason: result.reason,
						},
						neuralResult: result,
					};
				}
			} catch (e) {
				if (e instanceof Error && e.message === 'cancelled') throw e;
				logger.error?.('ModerateMessage: AI error', e);
			}
		}
	}

	// 2. Ключевые слова
	const keywordType = detectKeywordViolation(lower, words, {
		filterProfanity: settings.getFilterProfanity(),
		filterAdvertising: settings.getFilterAdvertising(),
	});

	if (keywordType) {
		return {
			violation: { type: keywordType },
		};
	}

	return { violation: null };
}
