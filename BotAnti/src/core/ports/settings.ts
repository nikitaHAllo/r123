/**
 * Порт: настройки модерации (вкл/выкл фильтров, модель).
 * Реализация читает из БД + env (infrastructure).
 */
export interface ISettings {
	getFilterProfanity(): boolean;
	getFilterAdvertising(): boolean;
	getUseNeuralNetwork(): boolean;
	getDeleteMessages(): boolean;
	getCurrentModel(): string;
	setFilterProfanity(value: boolean): void;
	setFilterAdvertising(value: boolean): void;
	setUseNeuralNetwork(value: boolean): void;
	setDeleteMessages(value: boolean): void;
	setCurrentModel(value: string): void;
}
