/**
 * Бизнес-сущность: тематика нейросети.
 */
export interface Topic {
	name: string;
	systemPrompt: string;
	keywords: string[];
	priority: number;
	enabled: boolean;
}
