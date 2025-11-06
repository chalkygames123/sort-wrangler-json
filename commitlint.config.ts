import { execSync } from 'node:child_process';
import {
	RuleConfigSeverity,
	type SyncRule,
	type UserConfig,
} from '@commitlint/types';
import { z } from 'zod';

const getWorkspacePackages = (): string[] => {
	const raw = execSync(
		`pnpm list --recursive --json --depth -1 --filter '!.'`,
		{
			encoding: 'utf8',
		},
	);

	if (!raw) {
		return [];
	}

	const schema = z.object({ name: z.string() }).array();
	const parsed: Array<{ name: string }> = schema.parse(JSON.parse(raw));
	const names = parsed.map((p) => p.name);

	return names;
};

export default {
	extends: ['@commitlint/config-conventional'],
	plugins: [
		{
			rules: {
				/** Requires or disallows parentheses when the scope is empty. */
				'custom/scope-empty-parentheses': ((
					{ header, scope, type },
					when = 'never',
				) => {
					if (scope) {
						return [true];
					}

					if (!header || !type) {
						return [true];
					}

					const pattern = new RegExp(`^${type}\\(\\):`);
					const hasHeaderParentheses = pattern.test(header);

					return [
						when === 'never' ? !hasHeaderParentheses : hasHeaderParentheses,
						`header ${when === 'never' ? 'must not' : 'must'} have parentheses when the scope is empty`,
					];
				}) satisfies SyncRule<string[]>,
				/** Requires or disallows scope to be one of the specified scopes or a combination of them (comma-separated with a space). */
				'custom/scope-enum': (({ scope }, when = 'always', value = []) => {
					if (!scope) {
						return [true];
					}

					if (value.length === 0) {
						return [true];
					}

					const scopesPattern = `(${value.join('|')})`;
					const validationPattern = new RegExp(
						`^${scopesPattern}(, ${scopesPattern})*$`,
					);
					const isFormatValid = validationPattern.test(scope);

					return [
						when === 'always' ? isFormatValid : !isFormatValid,
						`scope ${when === 'always' ? 'must' : 'must not'} be one of [${value.join(', ')}], or a combination of them (comma-separated, e.g., "admin, web")`,
					];
				}) satisfies SyncRule<string[]>,
			},
		},
	],
	rules: {
		'body-max-line-length': [RuleConfigSeverity.Disabled],
		'footer-max-line-length': [RuleConfigSeverity.Disabled],
		'header-max-length': [RuleConfigSeverity.Disabled],
		'scope-case': [RuleConfigSeverity.Error, 'always', 'lower-case'],
		'subject-case': [RuleConfigSeverity.Disabled],
		'custom/scope-empty-parentheses': [RuleConfigSeverity.Error, 'never'],
		'custom/scope-enum': [
			RuleConfigSeverity.Error,
			'always',
			[...getWorkspacePackages(), 'deps'],
		],
	},
} satisfies UserConfig;
