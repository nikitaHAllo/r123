/**
 * Чистая логика фильтров по ключевым словам.
 * Не зависит от БД, только от переданных множеств слов.
 */
export function checkProfanity(text: string, profanityWords: Set<string>): boolean {
	const lower = text.toLowerCase();
	return [...profanityWords].some((word) => lower.includes(word));
}

export function checkAd(text: string, adWords: Set<string>): boolean {
	const lower = text.toLowerCase();
	return [...adWords].some((word) => lower.includes(word));
}

export function checkCustom(text: string, customWords: Set<string>): boolean {
	const lower = text.toLowerCase();
	return [...customWords].some((word) => lower.includes(word));
}

export interface FilterWords {
	profanity: Set<string>;
	ad: Set<string>;
	custom: Set<string>;
}

export function detectKeywordViolation(
	text: string,
	words: FilterWords,
	options: { filterProfanity: boolean; filterAdvertising: boolean }
): 'violation_profanity' | 'violation_ad' | 'violation_custom' | null {
	if (options.filterProfanity && checkProfanity(text, words.profanity)) {
		return 'violation_profanity';
	}
	if (options.filterAdvertising && checkAd(text, words.ad)) {
		return 'violation_ad';
	}
	if (checkCustom(text, words.custom)) {
		return 'violation_custom';
	}
	return null;
}
