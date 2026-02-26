/**
 * Порт: абстракция работы с БД.
 * Реализации — в infrastructure/database.
 */
export type WordTable = 'profanity_words' | 'ad_keywords' | 'custom_words';

export interface IDatabase {
	init(): Promise<void>;
	getWords(table: WordTable): Promise<string[]>;
	addWord(table: WordTable, word: string): Promise<void>;
	deleteWord(table: WordTable, word: string): Promise<void>;
	getSetting(key: string): Promise<string | null>;
	setSetting(key: string, value: string): Promise<void>;
	recordStat(type: string, timestamp: number): Promise<void>;
	getTopics(): Promise<Array<{ name: string; system_prompt: string; priority: number; enabled: number }>>;
	updateTopicEnabled(name: string, enabled: boolean): Promise<void>;
}
