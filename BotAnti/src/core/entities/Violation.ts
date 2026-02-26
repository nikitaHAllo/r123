/**
 * Бизнес-сущность: результат проверки (вердикт).
 */
export type ViolationType =
	| 'violation_profanity'
	| 'violation_ad'
	| 'violation_custom'
	| `neural_${string}`;

export interface Violation {
	type: ViolationType;
	reason?: string;
	confidence?: number;
	topic?: string;
}
