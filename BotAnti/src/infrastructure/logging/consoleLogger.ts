import type { ILogger } from '../../core/ports/logger.js';

/**
 * Реализация логгера через console.
 */
export const consoleLogger: ILogger = {
	info(message: string, ...args: unknown[]) {
		console.log(message, ...args);
	},
	warn(message: string, ...args: unknown[]) {
		console.warn(message, ...args);
	},
	error(message: string, ...args: unknown[]) {
		console.error(message, ...args);
	},
	debug(message: string, ...args: unknown[]) {
		console.debug(message, ...args);
	},
};
