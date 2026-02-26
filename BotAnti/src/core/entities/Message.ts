/**
 * Бизнес-сущность: сообщение для модерации.
 */
export interface Message {
	author: string;
	text: string;
	userId?: string | number;
}
