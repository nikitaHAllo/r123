import type { TelegramClient } from 'telegram';
import type { EntityLike } from 'telegram/define';
import {
	FILTER_PROFANITY,
	FILTER_ADVERTISING,
	USE_NEURAL_NETWORK,
} from '../state.js';
import { checkProfanity, checkAd, checkCustom } from '../filters.js';
import { analyzeSequentially } from '../neural.js';
import { getViolationReason } from './violationUserbot.js';
import type { MessageData } from './documentHandler.js';

const MAX_MESSAGE_LENGTH = 4000;
const PROGRESS_UPDATE_FREQUENCY = 5;
const UPDATE_INTERVAL_MS = 1000;

const activeAnalyses = new Map<string, { cancel: boolean; controller: AbortController }>();

export function cancelAnalysis(chatIdStr: string): boolean {
	const a = activeAnalyses.get(chatIdStr);
	if (a && !a.cancel) {
		a.cancel = true;
		a.controller.abort();
		return true;
	}
	return false;
}

function escapeHtml(str = ''): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

interface DetectedViolation {
	index: number;
	author: string;
	text: string;
	violationType: string;
	source: string;
	confidence?: number;
	topic?: string;
	reasonText?: string;
}

async function analyzeOne(
	msg: MessageData,
	index: number,
	total: number,
	controller: AbortController,
	violations: DetectedViolation[]
): Promise<void> {
	const text = msg.text.toLowerCase();
	let violation: string | null = null;
	let source = 'custom';

	if (USE_NEURAL_NETWORK && text.length > 3) {
		try {
			const r = await analyzeSequentially(text, controller.signal);
			if (r?.detected) {
				violation = `neural_${r.topic}`;
				source = 'neural';
				violations.push({
					index: index + 1,
					author: msg.author,
					text: msg.text,
					violationType: violation,
					source,
					confidence: r.confidence,
					topic: r.topic,
					reasonText: r.reason,
				});
				return;
			}
		} catch (e) {
			if (e instanceof Error && e.message === 'cancelled') throw e;
		}
	}
	if (FILTER_PROFANITY && checkProfanity(text)) violation = 'violation_profanity';
	if (!violation && FILTER_ADVERTISING && checkAd(text)) violation = 'violation_ad';
	if (!violation && checkCustom(text)) violation = 'violation_custom';
	if (violation) {
		if (violation === 'violation_profanity') source = 'profanity';
		else if (violation === 'violation_ad') source = 'advertising';
		violations.push({
			index: index + 1,
			author: msg.author,
			text: msg.text,
			violationType: violation,
			source,
		});
	}
}

function formatOne(v: DetectedViolation): string {
	const reason = getViolationReason(v.violationType);
	return `${v.index}. ${v.author}\n⚠️ ${reason}\n💬 "${v.text}"`;
}

async function sendReport(
	client: TelegramClient,
	chat: EntityLike,
	violations: DetectedViolation[],
	fileName: string
): Promise<void> {
	if (violations.length === 0) {
		await client.sendMessage(chat, { message: `✅ В файле ${fileName} нарушений не найдено.` });
		return;
	}
	let chunk = '';
	for (const v of violations) {
		const line = formatOne(v) + '\n\n';
		if ((chunk + line).length > MAX_MESSAGE_LENGTH && chunk) {
			await client.sendMessage(chat, { message: chunk });
			chunk = line;
		} else {
			chunk += line;
		}
	}
	if (chunk) await client.sendMessage(chat, { message: chunk });
}

export async function startAnalysisUserbot(
	client: TelegramClient,
	chat: EntityLike,
	chatIdStr: string,
	messages: MessageData[],
	fileName: string,
	_rawData?: any
): Promise<void> {
	if (activeAnalyses.has(chatIdStr)) {
		await client.sendMessage(chat, {
			message: '⚠️ Анализ уже выполняется. Отмените: /cancel_analysis',
		});
		return;
	}

	const controller = new AbortController();
	activeAnalyses.set(chatIdStr, { cancel: false, controller });

	const total = messages.length;
	const startTime = Date.now();
	let lastUpdate = 0;

	const progressMsg = await client.sendMessage(chat, {
		message: `🔍 Начинаю анализ ${total} сообщений...\n\n📊 0 / ${total}\n⏱ 0 сек`,
	});

	const violations: DetectedViolation[] = [];

	try {
		for (let i = 0; i < messages.length; i++) {
			await Promise.resolve();
			const a = activeAnalyses.get(chatIdStr);
			if (a?.cancel) throw new Error('cancelled');

			await analyzeOne(messages[i], i, total, controller, violations);

			const now = Date.now();
			if (i % PROGRESS_UPDATE_FREQUENCY === 0 || i === total - 1) {
				if (now - lastUpdate >= UPDATE_INTERVAL_MS || i === total - 1) {
					lastUpdate = now;
					const elapsed = Math.floor((now - startTime) / 1000);
					try {
						await client.editMessage(chat, {
							message: progressMsg.id,
							text: `🔍 Анализ...\n\n📊 ${i + 1} / ${total}\n⏱ ${elapsed} сек`,
						});
					} catch {}
				}
			}
		}
	} catch (e) {
		if (e instanceof Error && e.message === 'cancelled') {
			const elapsed = Math.floor((Date.now() - startTime) / 1000);
			await client.editMessage(chat, {
				message: progressMsg.id,
				text: `🛑 Анализ прерван.\n\n📊 Проанализировано: ${violations.length} из ${total}\n⏱ ${elapsed} сек`,
			}).catch(() => {});
			activeAnalyses.delete(chatIdStr);
			return;
		}
		throw e;
	} finally {
		activeAnalyses.delete(chatIdStr);
	}

	const elapsed = Math.floor((Date.now() - startTime) / 1000);
	await client.editMessage(chat, {
		message: progressMsg.id,
		text: `✅ Анализ завершён.\n\n📊 ${total} сообщений\n⏱ ${elapsed} сек`,
	}).catch(() => {});

	await sendReport(client, chat, violations, fileName);
}
