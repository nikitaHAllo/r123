/**
 * Базовая ошибка приложения.
 */
export class AppError extends Error {
	constructor(
		message: string,
		public readonly code?: string
	) {
		super(message);
		this.name = 'AppError';
		Object.setPrototypeOf(this, AppError.prototype);
	}
}

export class CancelledError extends AppError {
	constructor() {
		super('Операция отменена', 'CANCELLED');
		this.name = 'CancelledError';
	}
}
