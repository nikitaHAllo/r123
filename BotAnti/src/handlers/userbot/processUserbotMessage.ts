/**
 * Обработка одного сообщения userbot: фильтры, нейросеть, логирование нарушения.
 */
import type { TelegramClient } from 'telegram';
import {
	FILTER_PROFANITY,
	FILTER_ADVERTISING,
	USE_NEURAL_NETWORK,
} from '../../state.js';
import { checkProfanity, checkAd, checkCustom } from '../../filters.js';
import { analyzeSequentially } from '../../neural.js';
import { handleViolationUserbot, type ViolationExtra } from '../violationUserbot.js';
import { dbPromise } from '../../db.js';

function detectViolation(text: string): string | null {
	if (FILTER_PROFANITY && checkProfanity(text)) return 'violation_profanity';
	if (FILTER_ADVERTISING && checkAd(text)) return 'violation_ad';
	if (checkCustom(text)) return 'violation_custom';
	return null;
}

async function checkMessageWithNeural(text: string): Promise<string | null> {
	try {
		const r = await analyzeSequentially(text);
		return r ? `neural_${r.topic}` : null;
	} catch (e) {
		if (e instanceof Error && e.message === 'cancelled') throw e;
		const err = e as { code?: string; message?: string };
		const msg = err?.message ?? String(e);
		const isTimeout =
			err?.code === 'ECONNABORTED' || /timeout|ETIMEDOUT/i.test(msg);
		if (isTimeout) {
			console.error(
				'Ошибка нейросети: таймаут (15 с). Проверьте OLLAMA_URL и доступность Ollama.',
			);
		} else {
			console.error('Ошибка нейросети:', msg);
		}
		return null;
	}
}

/** Обрабатывает одно сообщение (фильтры + нейросеть + логирование). Используется и в событиях, и в polling. */
export async function processOneMessage(
	client: TelegramClient,
	chatIdStr: string,
	messageId: number,
	userId: number,
	userName: string,
	text: string,
	chatTitle: string | undefined,
	isPrivate: boolean,
	channelIdForLog?: string,
	messageDate?: number,
	extra?: ViolationExtra,
): Promise<void> {
	const channelLabel = channelIdForLog ?? chatIdStr;
	const textLower = text.toLowerCase();
	let violation: string | null = detectViolation(textLower);
	if (violation) {
		console.log('  (фильтр сработал, нейросеть не вызываем)');
	} else if (USE_NEURAL_NETWORK && textLower.length > 3) {
		console.log('  проверка нейросетью…');
		try {
			violation = await checkMessageWithNeural(textLower);
		} catch {}
	}
	if (violation) {
		console.log(`  🚨 [канал ${channelLabel}] нарушение: ${violation}`);
		await handleViolationUserbot(
			client,
			chatIdStr,
			messageId,
			userId,
			userName,
			text,
			violation,
			chatTitle,
			isPrivate,
			messageDate,
			extra,
		);
	} else {
		await dbPromise.then((db) =>
			db.run('INSERT INTO statistics (type,timestamp) VALUES (?,?)', [
				'message_ok',
				Math.floor(Date.now() / 1000),
			]),
		);
	}
}
