import { describe, it, expect } from 'vitest';
import {
	checkProfanity,
	checkAd,
	checkCustom,
	detectKeywordViolation,
	type FilterWords,
} from '../keywordFilter.js';

describe('keywordFilter', () => {
	const words: FilterWords = {
		profanity: new Set(['плохое', 'брань']),
		ad: new Set(['реклама', 'купить', 'http']),
		custom: new Set(['запрет']),
	};

	describe('checkProfanity', () => {
		it('возвращает true, если в тексте есть слово из списка брани', () => {
			expect(checkProfanity('тут плохое слово', words.profanity)).toBe(true);
			expect(checkProfanity('БРАНЬ в тексте', words.profanity)).toBe(true);
		});
		it('возвращает false, если бранных слов нет', () => {
			expect(checkProfanity('нормальный текст', words.profanity)).toBe(false);
		});
	});

	describe('checkAd', () => {
		it('возвращает true при наличии рекламного ключевого слова', () => {
			expect(checkAd('переходи по ссылке http://example.com', words.ad)).toBe(true);
			expect(checkAd('купить недорого', words.ad)).toBe(true);
		});
		it('возвращает false без рекламы', () => {
			expect(checkAd('просто сообщение', words.ad)).toBe(false);
		});
	});

	describe('checkCustom', () => {
		it('возвращает true при пользовательском слове', () => {
			expect(checkCustom('это запрет контент', words.custom)).toBe(true);
		});
		it('возвращает false без кастомного слова', () => {
			expect(checkCustom('другое слово', words.custom)).toBe(false);
		});
	});

	describe('detectKeywordViolation', () => {
		it('определяет violation_profanity при включённом фильтре брани', () => {
			expect(
				detectKeywordViolation('текст с плохое', words, {
					filterProfanity: true,
					filterAdvertising: false,
				})
			).toBe('violation_profanity');
		});
		it('определяет violation_ad при включённом фильтре рекламы', () => {
			expect(
				detectKeywordViolation('заходи http://spam.com', words, {
					filterProfanity: false,
					filterAdvertising: true,
				})
			).toBe('violation_ad');
		});
		it('определяет violation_custom (кастомные слова всегда активны)', () => {
			expect(
				detectKeywordViolation('здесь запрет', words, {
					filterProfanity: false,
					filterAdvertising: false,
				})
			).toBe('violation_custom');
		});
		it('возвращает null при отсутствии нарушений', () => {
			expect(
				detectKeywordViolation('обычное сообщение без нарушений', words, {
					filterProfanity: true,
					filterAdvertising: true,
				})
			).toBe(null);
		});
	});
});
