#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { ESLint, type Linter } from 'eslint';
import eslintPluginJsonc from 'eslint-plugin-jsonc';
import type { JSONSchema7 } from 'json-schema';
import jsoncEslintParser from 'jsonc-eslint-parser';

export interface SortKeysConfig {
	pathPattern: string;
	hasProperties?: string[];
	order:
		| string[]
		| { type: 'asc' | 'desc'; caseSensitive?: boolean; natural?: boolean };
}

/**
 * Type guard for checking if a value is a record.
 *
 * @param value - The value to check.
 * @returns True if the value is a non-null object.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

/**
 * Type guard for checking if a value is a JSONSchema7.
 *
 * @param value - The value to check.
 * @returns True if the value is structurally compatible with JSONSchema7.
 */
const isJSONSchema7 = (value: unknown): value is JSONSchema7 => isRecord(value);

/**
 * Resolves a JSON Schema $ref to its definition.
 *
 * @param schema - The JSON Schema containing definitions.
 * @param ref - The reference string (e.g., "#/definitions/RawConfig").
 * @returns The resolved schema definition.
 */
export const resolveSchemaRef = (
	schema: JSONSchema7,
	ref: string,
): JSONSchema7 => {
	const refPath = ref.split('/').slice(1);
	let current: unknown = schema;

	for (const segment of refPath) {
		if (!isRecord(current) || !(segment in current)) {
			throw new Error(`Unable to resolve schema reference: ${ref}`);
		}

		current = current[segment];
	}

	if (!isJSONSchema7(current)) {
		throw new Error(
			`Schema reference does not resolve to a valid object: ${ref}`,
		);
	}

	return current;
};

/**
 * Extracts the root schema definition from a JSON Schema.
 *
 * @param schema - The JSON Schema to extract from.
 * @returns The root schema definition with properties.
 */
export const extractRootSchema = (schema: JSONSchema7): JSONSchema7 => {
	if (schema.$ref) {
		return resolveSchemaRef(schema, schema.$ref);
	}

	if (schema.properties) {
		return schema;
	}

	throw new Error('Unable to extract properties from the schema.');
};

/**
 * Extracts the $schema property value from a JSONC configuration file.
 *
 * @param ast - The parsed AST of the JSONC file.
 * @returns The value of the $schema property.
 */
export const extractSchemaPath = (
	ast: ReturnType<typeof jsoncEslintParser.parseForESLint>,
): string => {
	const expressionStatement = ast.ast.body[0];

	if (
		!expressionStatement ||
		expressionStatement.type !== 'JSONExpressionStatement' ||
		expressionStatement.expression.type !== 'JSONObjectExpression'
	) {
		throw new Error(
			'The configuration file does not contain a valid JSON object.',
		);
	}

	const schemaProperty = expressionStatement.expression.properties.find(
		(prop): prop is jsoncEslintParser.AST.JSONProperty =>
			prop.type === 'JSONProperty' &&
			prop.key.type === 'JSONLiteral' &&
			prop.key.value === '$schema',
	);

	if (
		!schemaProperty ||
		schemaProperty.value.type !== 'JSONLiteral' ||
		typeof schemaProperty.value.value !== 'string'
	) {
		throw new Error(
			'The configuration file does not contain a valid $schema property.',
		);
	}

	return schemaProperty.value.value;
};

/**
 * Generates the property order from a JSON Schema.
 *
 * @param schema - The root JSON Schema with properties.
 * @returns An array of property names with 'env' moved to the end if present.
 */
export const generatePropertyOrder = (schema: JSONSchema7): string[] => {
	if (!schema.properties) {
		throw new Error('The root schema does not contain any properties.');
	}

	const allKeys = Object.keys(schema.properties);

	return [
		...allKeys.filter((key) => key !== 'env'),
		...(allKeys.includes('env') ? ['env'] : []),
	];
};

/**
 * Creates sort keys configurations for the root and env objects.
 *
 * @param propertyOrder - The property order to use.
 * @returns An array of sort keys configurations.
 */
export const createSortKeysConfigs = (
	propertyOrder: string[],
): SortKeysConfig[] => [
	{
		pathPattern: '^$',
		order: propertyOrder,
	},
	{
		pathPattern: '^env\\..+$',
		order: propertyOrder,
	},
];

/**
 * Creates an ESLint instance configured for sorting JSONC files.
 *
 * @param sortKeysConfigs - The sort keys configuration.
 * @returns A configured ESLint instance.
 */
export const createSortingESLint = (
	sortKeysConfigs: SortKeysConfig[],
): ESLint => {
	const eslintConfig = [
		{
			files: ['**/*.jsonc'],
			languageOptions: {
				parser: jsoncEslintParser,
			},
			plugins: {
				jsonc: eslintPluginJsonc as ESLint.Plugin,
			},
			rules: {
				'jsonc/sort-keys': ['error', ...sortKeysConfigs],
			},
		},
	] satisfies Linter.Config<Linter.RulesRecord>[];

	return new ESLint({
		overrideConfigFile: true,
		overrideConfig: eslintConfig,
		fix: true,
	});
};

/**
 * Sorts a JSONC content using ESLint.
 *
 * @param content - The JSONC content to sort.
 * @param filePath - The file path for error reporting.
 * @param sortKeysConfigs - The sort keys configuration.
 * @returns The sorted content and lint result.
 */
export const sortJsoncContent = async (
	content: string,
	filePath: string,
	sortKeysConfigs: SortKeysConfig[],
): Promise<{ sortedContent: string; result: ESLint.LintResult }> => {
	const eslint = createSortingESLint(sortKeysConfigs);
	const results = await eslint.lintText(content, { filePath });
	const [result] = results;

	if (!result) {
		throw new Error('ESLint did not return any results.');
	}

	if (result.fatalErrorCount > 0) {
		const fatalError = result.messages.find((message) => message.fatal);

		throw new Error(`Fatal error: ${fatalError?.message ?? 'Unknown error'}`);
	}

	const sortedContent = result.output ?? content;

	return { sortedContent, result };
};

/**
 * Main function for CLI execution.
 */
const main = async (): Promise<void> => {
	const { values } = parseArgs({
		options: {
			config: {
				type: 'string',
				short: 'c',
				default: './wrangler.jsonc',
			},
			write: {
				type: 'boolean',
				short: 'w',
				default: false,
			},
			help: {
				type: 'boolean',
				short: 'h',
				default: false,
			},
		},
		strict: true,
		allowPositionals: false,
	});

	if (values.help) {
		console.log(`
Usage: sort-wrangler-jsonc [options]

Options:
  -c, --config <path>  Path to the configuration file (default: ./wrangler.jsonc)
  -w, --write          Write the sorted output to the file
  -h, --help           Display this help message

Examples:
  sort-wrangler-jsonc                      # Display sorted output
  sort-wrangler-jsonc -w                   # Sort and write to default file
  sort-wrangler-jsonc -c config.jsonc -w   # Sort and write to specified file
`);

		process.exit(0);
	}

	const configPath = values.config;
	const shouldWrite = values.write;

	const configContent = await readFile(configPath, 'utf-8');
	const ast = jsoncEslintParser.parseForESLint(configContent, {
		filePath: configPath,
	});

	const schemaPath = extractSchemaPath(ast);
	const schemaFilePath = join(dirname(configPath), schemaPath);

	const schemaContent = await readFile(schemaFilePath, 'utf-8');
	const schema: JSONSchema7 = JSON.parse(schemaContent);

	const rootSchema = extractRootSchema(schema);
	const rootPropertyOrder = generatePropertyOrder(rootSchema);
	const sortKeysConfigs = createSortKeysConfigs(rootPropertyOrder);

	const { sortedContent } = await sortJsoncContent(
		configContent,
		configPath,
		sortKeysConfigs,
	);

	if (shouldWrite) {
		await writeFile(configPath, sortedContent, 'utf-8');

		console.log(`Successfully sorted and wrote to ${configPath}.`);
	} else {
		process.stdout.write(sortedContent);
	}
};

// Only run main when executed as a script (not when imported as a module)
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error('Error:', error instanceof Error ? error.message : error);

		process.exit(1);
	});
}
