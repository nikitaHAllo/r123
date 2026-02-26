import { initDB, getWords, addWord, dbPromise, loadSettingsFromDB } from './db.js';
import { updateProfanity, updateAd, updateCustom } from './filters.js';
import { TOPICS } from './neural.js';
import { PROFANITY_WORDS, AD_KEYWORDS, FILTER_PROFANITY, FILTER_ADVERTISING } from './config.js';
import { setProfanity, setAdvertising } from './state.js';

export async function initUserbot(): Promise<void> {
	await initDB();

	const profanity = await getWords('profanity_words');
	const ad = await getWords('ad_keywords');
	if (profanity.length === 0 && PROFANITY_WORDS.length > 0) {
		for (const word of PROFANITY_WORDS) await addWord('profanity_words', word);
	}
	if (ad.length === 0 && AD_KEYWORDS.length > 0) {
		for (const word of AD_KEYWORDS) await addWord('ad_keywords', word);
	}

	updateProfanity(await getWords('profanity_words'));
	updateAd(await getWords('ad_keywords'));
	updateCustom(await getWords('custom_words'));

	setProfanity(FILTER_PROFANITY);
	setAdvertising(FILTER_ADVERTISING);
	await loadSettingsFromDB();

	const db = await dbPromise;
	const rows = (await db.all(
		`SELECT name, system_prompt, priority, enabled FROM topics`
	)) as { name: string; system_prompt: string; priority: number; enabled: number }[];

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
