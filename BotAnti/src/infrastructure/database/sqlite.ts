import type { IDatabase, WordTable } from '../../core/ports/database.js';
import { dbPromise, initDB, getSetting, setSetting, addWord, deleteWord, getWords } from '../../db.js';

/**
 * Реализация порта IDatabase через SQLite (текущий db.ts).
 */
export const sqliteDatabase: IDatabase = {
	async init() {
		await initDB();
	},

	async getWords(table: WordTable) {
		return getWords(table);
	},

	async addWord(table: WordTable, word: string) {
		await addWord(table, word);
	},

	async deleteWord(table: WordTable, word: string) {
		await deleteWord(table, word);
	},

	async getSetting(key: string) {
		return getSetting(key);
	},

	async setSetting(key: string, value: string) {
		await setSetting(key, value);
	},

	async recordStat(type: string, timestamp: number) {
		const db = await dbPromise;
		await db.run('INSERT INTO statistics (type, timestamp) VALUES (?, ?)', [type, timestamp]);
	},

	async getTopics() {
		const db = await dbPromise;
		const rows = (await db.all(
			'SELECT name, system_prompt, priority, enabled FROM topics'
		)) as { name: string; system_prompt: string; priority: number; enabled: number }[];
		return rows;
	},

	async updateTopicEnabled(name: string, enabled: boolean) {
		const db = await dbPromise;
		await db.run('UPDATE topics SET enabled = ? WHERE name = ?', [enabled ? 1 : 0, name]);
	},
};
