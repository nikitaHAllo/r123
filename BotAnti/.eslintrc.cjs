/* eslint-env node */
/** @type {import('eslint').Linter.Config} */
module.exports = {
	root: true,
	env: { node: true, es2022: true },
	parser: '@typescript-eslint/parser',
	parserOptions: {
		ecmaVersion: 'latest',
		sourceType: 'module',
	},
	plugins: ['@typescript-eslint', 'import'],
	extends: [
		'eslint:recommended',
		'plugin:@typescript-eslint/recommended',
	],
	settings: {
		// Только для import/no-restricted-paths (проверка путей слоёв)
		'import/ignore': ['node_modules', '\\.(ts|tsx|js|json)$'],
	},
	rules: {
		'@typescript-eslint/no-explicit-any': 'warn',
		'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
		'@typescript-eslint/no-unused-expressions': 'warn',
		'no-console': 'off',
		'no-case-declarations': 'warn',
		'no-empty': 'warn',
		'no-dupe-else-if': 'warn',
		'no-mixed-spaces-and-tabs': 'warn',
		'prefer-const': 'warn',
		'no-useless-escape': 'warn',

		// Границы слоёв Clean Architecture
		'import/no-restricted-paths': [
			'error',
			{
				zones: [
					{
						target: './src/core',
						from: './src/infrastructure',
						message: 'Core не должен зависеть от infrastructure',
					},
					{
						target: './src/core',
						from: './src/delivery',
						message: 'Core не должен зависеть от delivery',
					},
					{
						target: './src/core',
						from: './src/handlers',
						message: 'Core не должен зависеть от handlers',
					},
					{
						target: './src/infrastructure',
						from: './src/delivery/bot',
						message: 'Infrastructure не должна зависеть от delivery/bot',
					},
					{
						target: './src/infrastructure',
						from: './src/delivery/userbot',
						message: 'Infrastructure не должна зависеть от delivery/userbot',
					},
					{
						target: './src/delivery/bot',
						from: './src/delivery/userbot',
						message: 'Bot не должен импортировать код Userbot',
					},
					{
						target: './src/delivery/userbot',
						from: './src/delivery/bot',
						message: 'Userbot не должен импортировать код Bot',
					},
				],
			},
		],
	},
	ignorePatterns: ['dist/', 'node_modules/', '*.js', '*.cjs'],
};
