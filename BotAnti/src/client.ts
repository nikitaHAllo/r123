import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { API_ID, API_HASH, SESSION_STRING } from './config.js';
import readline from 'readline';

function getSessionString(): string {
	const s = typeof SESSION_STRING === 'string' ? SESSION_STRING.trim() : '';
	if (!s) return '';
	if (s[0] !== '1') {
		console.warn('⚠️ SESSION_STRING в .env не похож на сессию GramJS (должен начинаться с "1"). Вход по коду.');
		return '';
	}
	return s;
}

export function createClient(): TelegramClient {
	const session = new StringSession(getSessionString());
	return new TelegramClient(session, API_ID, API_HASH, {
		connectionRetries: 5,
		useWSS: false,
		floodSleepThreshold: 60,
		requestRetries: 5,
	});
}

const AUTH_KEY_DUPLICATED_MSG =
	'Сессия уже используется в другом месте или недействительна.\n' +
	'Сделайте так: 1) Удалите SESSION_STRING из .env (или очистите значение). 2) Закройте все другие экземпляры бота с этим аккаунтом. 3) Перезапустите и войдите по коду. 4) Сохраните новый SESSION_STRING.';

export async function startClient(client: TelegramClient): Promise<void> {
	if (getSessionString()) {
		try {
			await client.connect();
			if (!(await client.checkAuthorization())) {
				throw new Error('Сессия недействительна. Получите новую: уберите SESSION_STRING и перезапустите.');
			}
			const me = await client.getMe();
			console.log('✅ Залогинен как userbot:', (me as any)?.firstName || (me as any)?.username || 'OK');
			return;
		} catch (err: unknown) {
			const e = err as { code?: number; errorMessage?: string };
			if (e?.code === 406 || e?.errorMessage === 'AUTH_KEY_DUPLICATED') {
				console.error('\n⚠️ AUTH_KEY_DUPLICATED (406)\n' + AUTH_KEY_DUPLICATED_MSG);
				throw new Error('AUTH_KEY_DUPLICATED');
			}
			throw err;
		}
	}

	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const ask = (q: string): Promise<string> =>
		new Promise((resolve) => rl.question(q, (ans) => resolve(ans || '')));

	console.log(
		'\n⚠️ Вход по коду. Важно:\n' +
		'  • Код приходит в приложение Telegram (не SMS) — подождите 1–2 минуты.\n' +
		'  • Не перезапускайте скрипт и не запрашивайте код повторно — иначе блокировка на 24 ч.\n' +
		'  • После успешного входа обязательно сохраните SESSION_STRING в .env — тогда код больше не понадобится.\n'
	);

	await client.start({
		phoneNumber: async () => await ask('Введите номер телефона (+7...): '),
		phoneCode: async () =>
			await ask(
				'Введите код из Telegram (приходит в приложении: Настройки → Конфиденциальность → Подтверждение входа; иногда 2–5 мин): '
			),
		password: async () => await ask('2FA пароль (если есть): '),
		onError: (err: unknown) => {
			const e = err as { code?: number; seconds?: number; message?: string };
			if (e?.code === 420 && typeof e?.seconds === 'number') {
				const hours = Math.ceil(e.seconds / 3600);
				console.error(
					'\n⚠️ Telegram заблокировал запрос кода на ~24 ч (слишком много попыток входа).\n' +
					`   Подождите ${hours} ч (${e.seconds} сек), не перезапускайте и не вводите номер снова.\n` +
					'   После разблокировки: один раз войдите по коду и сразу сохраните SESSION_STRING в .env — тогда код больше не будет запрашиваться.'
				);
			} else {
				console.error('Ошибка входа:', err);
			}
		},
	});

	rl.close();
	const sessionString = client.session.save();
	console.log('\n✅ Вход выполнен. Сохраните сессию в .env:\nSESSION_STRING=' + sessionString + '\n');
	const me = await client.getMe();
	console.log('Залогинен:', (me as any)?.firstName || (me as any)?.username || 'OK');
}
