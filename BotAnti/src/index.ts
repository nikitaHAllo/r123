import { startUserbot } from './delivery/userbot/userbot.js';

startUserbot().catch((err) => console.error('Ошибка:', err));
