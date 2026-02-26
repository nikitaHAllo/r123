/**
 * Чтение конфигурации из .env.
 * Единственное место, где используется dotenv и process.env.
 */
import dotenv from 'dotenv';
dotenv.config();

const toBool = (v?: string) => v?.toLowerCase() === 'true' || v === '1';

const apiIdStr = process.env.API_ID;
const apiHash = process.env.API_HASH;
export const API_ID = apiIdStr ? parseInt(apiIdStr, 10) : 0;
export const API_HASH = apiHash || '';
export const SESSION_STRING = process.env.SESSION_STRING || '';
export const BOT_TOKEN = process.env.BOT_TOKEN || '';

export const BOT_USERNAME = process.env.BOT_USERNAME
	? process.env.BOT_USERNAME.trim().replace(/^@/, '')
	: null;

const hasUserbot = API_ID && API_HASH;
const hasBot = !!BOT_TOKEN;
if (!hasUserbot && !hasBot) {
	throw new Error(
		'❌ Укажите либо BOT_TOKEN (бот), либо API_ID и API_HASH в .env (userbot, https://my.telegram.org)'
	);
}

export const ADMINS_RAW = process.env.ADMINS
	? process.env.ADMINS.split(',')
			.map((x) => x.trim().toLowerCase())
			.filter(Boolean)
	: [];

export const ADMINS = process.env.ADMINS
	? process.env.ADMINS.split(',')
			.map((x) => Number(x.trim()))
			.filter((n) => !isNaN(n) && n !== 0)
	: [];

export const ALLOWED_CHATS = process.env.ALLOWED_CHATS
	? process.env.ALLOWED_CHATS.split(',')
			.map((x) => x.trim())
			.filter(Boolean)
	: [];

export const LOG_CHAT_ID = process.env.LOG_CHAT_ID?.trim() ?? null;
export const LOG_CHAT_IDS: string[] = LOG_CHAT_ID
	? LOG_CHAT_ID.split(',')
			.map((x) => x.trim())
			.filter(Boolean)
	: [];

export const FILTER_PROFANITY_ENV = toBool(process.env.FILTER_PROFANITY);
export const FILTER_ADVERTISING_ENV = toBool(process.env.FILTER_ADVERTISING);

export const PROFANITY_WORDS = process.env.PROFANITY_WORDS
	? process.env.PROFANITY_WORDS.split(',')
			.map((w) => w.trim().toLowerCase())
			.filter(Boolean)
	: [];

export const AD_KEYWORDS = process.env.AD_KEYWORDS
	? process.env.AD_KEYWORDS.split(',')
			.map((w) => w.trim().toLowerCase())
			.filter(Boolean)
	: [];
