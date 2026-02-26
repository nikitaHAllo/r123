import { startBot } from './delivery/bot/bot.js';

startBot().catch((err) => console.error('Ошибка в боте:', err));
