import type { Topic } from '../entities/index.js';

/**
 * Порт: абстракция нейросети (LLM).
 * Реализации — Ollama, OpenAI и т.д. в infrastructure/ai.
 */
export interface NeuralResult {
	topic: string;
	detected: boolean;
	confidence?: number;
	reason?: string;
}

export interface TopicForAi {
	name: string;
	systemPrompt: string;
}

export interface IAiProvider {
	analyze(
		message: string,
		topic: TopicForAi,
		model: string,
		signal?: AbortSignal
	): Promise<NeuralResult>;
}

/**
 * Порт: хранилище тематик (загружаются из БД в рантайме).
 */
export interface ITopicsProvider {
	getTopics(): Topic[];
	loadFromStorage(): Promise<void>;
}
