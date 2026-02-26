import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { API_ID, API_HASH, SESSION_STRING } from './config.js';
import readline from 'readline';

export function createClient(): TelegramClient {
	const session = new StringSession(SESSION_STRING);
	return new TelegramClient(session, API_ID, API_HASH, {
		connectionRetries: 5,
		useWSS: false,
	});
}

export async function startClient(client: TelegramClient): Promise<void> {
	if (SESSION_STRING) {
		await client.connect();
		if (!(await client.checkAuthorization())) {
			throw new Error('Сессия недействительна. Получите новую: уберите SESSION_STRING и перезапустите.');
		}
		const me = await client.getMe();
		console.log('✅ Залогинен как userbot:', (me as any)?.firstName || (me as any)?.username || 'OK');
		return;
	}

	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const ask = (q: string): Promise<string> =>
		new Promise((resolve) => rl.question(q, (ans) => resolve(ans || '')));

	await client.start({
		phoneNumber: async () => await ask('Введите номер телефона (+7...): '),
		phoneCode: async () => await ask('Введите код из Telegram: '),
		password: async () => await ask('2FA пароль (если есть): '),
		onError: (err) => console.error('Ошибка входа:', err),
	});

	rl.close();
	const sessionString = client.session.save();
	console.log('\n✅ Вход выполнен. Сохраните сессию в .env:\nSESSION_STRING=' + sessionString + '\n');
	const me = await client.getMe();
	console.log('Залогинен:', (me as any)?.firstName || (me as any)?.username || 'OK');
}
