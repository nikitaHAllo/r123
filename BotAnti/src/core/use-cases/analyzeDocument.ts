import type { Message, Violation } from '../entities/index.js';
import type { ModerateMessageResult } from './moderateMessage.js';

export interface AnalyzeDocumentInput {
	messages: Message[];
	limit?: number;
	signal?: AbortSignal;
	onProgress?: (current: number, total: number) => void;
}

export interface DocumentViolation {
	index: number;
	author: string;
	text: string;
	violation: Violation;
}

export interface AnalyzeDocumentResult {
	violations: DocumentViolation[];
	processed: number;
	total: number;
}

/**
 * Сценарий: анализ документа (массива сообщений).
 * Для каждого сообщения вызывается переданная функция модерации.
 */
export async function analyzeDocument(
	input: AnalyzeDocumentInput,
	moderateOne: (
		text: string,
		signal?: AbortSignal
	) => Promise<ModerateMessageResult>
): Promise<AnalyzeDocumentResult> {
	const { messages, limit, signal, onProgress } = input;
	const total = limit != null ? Math.min(limit, messages.length) : messages.length;
	const violations: DocumentViolation[] = [];

	for (let i = 0; i < total; i++) {
		if (signal?.aborted) {
			throw new Error('cancelled');
		}
		const msg = messages[i];
		const result = await moderateOne(msg.text, signal);
		if (result.violation) {
			violations.push({
				index: i + 1,
				author: msg.author,
				text: msg.text,
				violation: result.violation,
			});
		}
		onProgress?.(i + 1, total);
	}

	return { violations, processed: total, total: messages.length };
}
