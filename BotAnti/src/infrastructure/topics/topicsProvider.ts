import type { Topic } from '../../core/entities/index.js';
import type { ITopicsProvider } from '../../core/ports/neuralNetwork.js';
import { TOPICS } from '../../neural.js';
import { loadTopicsFromDB } from '../../neural.js';

/**
 * Провайдер тематик: обёртка над глобальным TOPICS и loadTopicsFromDB.
 * Для полной Clean Architecture темы можно загружать через IDatabase.getTopics() и хранить в памяти здесь.
 */
export const topicsProvider: ITopicsProvider = {
	getTopics(): Topic[] {
		return TOPICS.map((t) => ({
			name: t.name,
			systemPrompt: t.systemPrompt,
			keywords: t.keywords ?? [],
			priority: t.priority,
			enabled: t.enabled,
		}));
	},

	async loadFromStorage() {
		await loadTopicsFromDB();
	},
};
