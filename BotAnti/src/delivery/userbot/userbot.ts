/**
 * Точка входа режима Userbot.
 */
import { createClient, startClient } from './client.js';
import { initUserbot } from '../../initUserbot.js';
import { registerUserbotHandlers } from '../../handlers/userbotHandlers.js';
import { ADMINS } from '../../config.js';

export async function startUserbot(): Promise<void> {
	await initUserbot();
	console.log('ADMINS:', ADMINS);

	const client = createClient();
	await startClient(client);

	await registerUserbotHandlers(client);
	console.log('Бот (userbot) запущен 🚀');
}
