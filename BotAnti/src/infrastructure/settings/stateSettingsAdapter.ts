import type { ISettings } from '../../core/ports/settings.js';
import * as state from '../../state.js';

/**
 * Реализация ISettings через текущий state.ts.
 * Состояние синхронизируется с БД через loadSettingsFromDB() в инициализации.
 */
export function createStateSettingsAdapter(): ISettings {
	return {
		getFilterProfanity: () => state.FILTER_PROFANITY,
		getFilterAdvertising: () => state.FILTER_ADVERTISING,
		getUseNeuralNetwork: () => state.USE_NEURAL_NETWORK,
		getDeleteMessages: () => state.DELETE_MESSAGES,
		getCurrentModel: () => state.getCurrentModel(),
		setFilterProfanity: state.setProfanity,
		setFilterAdvertising: state.setAdvertising,
		setUseNeuralNetwork: state.setNeuralNetwork,
		setDeleteMessages: state.setDeleteMessages,
		setCurrentModel: state.setCurrentModel,
	};
}
