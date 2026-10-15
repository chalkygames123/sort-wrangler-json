import { defineConfig } from 'oxfmt';

export default defineConfig({
	overrides: [
		{
			files: ['*.jsonc'],
			options: {
				trailingComma: 'none',
			},
		},
	],
	printWidth: 120,
	singleQuote: true,
	sortImports: {},
	sortPackageJson: {
		sortScripts: true,
	},
});
