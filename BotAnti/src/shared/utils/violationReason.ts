/**
 * Человекочитаемые названия типов нарушений.
 */
const VIOLATION_REASONS: Record<string, string> = {
	violation_profanity: 'ненормативная лексика',
	violation_ad: 'реклама',
	violation_custom: 'запрещенные слова',
	neural_bad_words: 'нежелательный контент (нейросеть)',
	neural_cars: 'автомобильная тема (нейросеть)',
	neural_advertising: 'реклама (нейросеть)',
};

export function getViolationReason(type: string | null): string {
	if (!type) return 'нарушение правил';
	return VIOLATION_REASONS[type] ?? 'нарушение правил';
}
