#!/usr/bin/env node

import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ESLint, type Linter } from 'eslint';
import eslintPluginJsonc from 'eslint-plugin-jsonc';
import type { JSONSchema7, JSONSchema7Definition } from 'json-schema';
import jsoncEslintParser from 'jsonc-eslint-parser';

/**
 * Represents how jsonc/sort-keys should order properties at a given path.
 */
interface SortKeysConfig {
	pathPattern: string;
	order: string[];
}

/**
 * Represents a segment in a property path when deriving jsonc/sort-keys patterns.
 */
type PathSegment = { kind: 'literal'; value: string } | { kind: 'wildcard' } | { kind: 'array' };

/**
 * Defines the path token used for array index lookups.
 */
const ARRAY_SEGMENT: PathSegment = { kind: 'array' };

/**
 * Defines the path token used for arbitrary property names.
 */
const WILDCARD_SEGMENT: PathSegment = { kind: 'wildcard' };

/**
 * Escapes characters that have special meaning in regular expressions.
 */
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const formatPathSegment = (segment: PathSegment): string => {
	switch (segment.kind) {
		case 'literal':
			return escapeRegex(segment.value);
		case 'wildcard':
			return '[^.]+';
		case 'array':
			return '\\[[0-9]+\\]';
		default: {
			throw new Error('Unexpected path segment kind.');
		}
	}
};

/**
 * Builds the regex that jsonc/sort-keys expects for a given path.
 */
const buildPathPattern = (segments: PathSegment[]): string => {
	if (segments.length === 0) {
		// Ensures eslint-plugin-jsonc receives '^$' so that the empty path matches the top-level.
		return '^$';
	}

	const segmentPattern = segments
		.map((segment, index) => {
			const prefix = index === 0 || segment.kind === 'array' ? '' : '\\.';

			return `${prefix}${formatPathSegment(segment)}`;
		})
		.join('');

	return `^${segmentPattern}$`;
};

/**
 * Follows chained $ref values until a concrete schema is reached.
 */
const resolveRefLoop = (
	sourceSchema: JSONSchema7,
	schema: JSONSchema7,
	visited: Set<JSONSchema7> = new Set(),
): JSONSchema7 => {
	let current: JSONSchema7 = schema;

	while (current.$ref) {
		if (visited.has(current)) {
			break;
		}

		visited.add(current);

		current = resolveSchemaRef(sourceSchema, current.$ref);
	}

	return current;
};

/**
 * Normalizes a schema definition, handling booleans per JSON Schema semantics.
 */
const resolveDefinition = (definition: JSONSchema7Definition | undefined): JSONSchema7 | null => {
	if (definition === undefined || definition === false) {
		return null;
	}

	if (definition === true) {
		// Treats "accept anything" as an empty schema so downstream logic can continue safely.
		return {};
	}

	return definition;
};

/**
 * Checks whether a schema contains object properties.
 */
const hasProperties = (
	schema: JSONSchema7,
): schema is JSONSchema7 & {
	properties: Record<string, JSONSchema7Definition>;
} => Boolean(schema.properties && isRecord(schema.properties));

/**
 * Checks whether a schema can describe an array.
 */
const isArraySchema = (schema: JSONSchema7): boolean => {
	if (Array.isArray(schema.type)) {
		return schema.type.includes('array');
	}

	return schema.type === 'array' || schema.items !== undefined;
};

/**
 * Checks whether a value is a record.
 *
 * @param value - The value to check.
 * @returns Whether the value is a non-null object.
 */
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * Checks whether a value is a JSONSchema7.
 *
 * @param value - The value to check.
 * @returns Whether the value is structurally compatible with JSONSchema7.
 */
const isJSONSchema7 = (value: unknown): value is JSONSchema7 => isRecord(value);

/**
 * Resolves a JSON Schema $ref to its definition.
 *
 * @param schema - The JSON Schema containing definitions.
 * @param ref - The reference string (e.g., "#/definitions/RawConfig").
 * @returns The resolved schema definition.
 */
export const resolveSchemaRef = (schema: JSONSchema7, ref: string): JSONSchema7 => {
	const refPath = ref.split('/').slice(1);
	let current: unknown = schema;

	for (const segment of refPath) {
		if (!isRecord(current) || !(segment in current)) {
			throw new Error(`Unable to resolve schema reference: ${ref}`);
		}

		current = current[segment];
	}

	if (!isJSONSchema7(current)) {
		throw new Error(`Schema reference does not resolve to a valid object: ${ref}`);
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
const extractSchemaPath = (ast: ReturnType<typeof jsoncEslintParser.parseForESLint>): string => {
	const expressionStatement = ast.ast.body[0];

	if (
		!expressionStatement ||
		expressionStatement.type !== 'JSONExpressionStatement' ||
		expressionStatement.expression.type !== 'JSONObjectExpression'
	) {
		throw new Error('The configuration file does not contain a valid JSON object.');
	}

	const schemaProperty = expressionStatement.expression.properties.find(
		(prop): prop is jsoncEslintParser.AST.JSONProperty =>
			prop.type === 'JSONProperty' && prop.key.type === 'JSONLiteral' && prop.key.value === '$schema',
	);

	if (
		!schemaProperty ||
		schemaProperty.value.type !== 'JSONLiteral' ||
		typeof schemaProperty.value.value !== 'string'
	) {
		throw new Error('The configuration file does not contain a valid $schema property.');
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

	// Relies on Object.keys preserving declaration order for plain objects, which matches JSON Schema author intent.
	const allKeys = Object.keys(schema.properties);

	return [...allKeys.filter((key) => key !== 'env'), ...(allKeys.includes('env') ? ['env'] : [])];
};

/**
 * Creates sort keys configurations for all object paths described by the schema.
 *
 * @param rootSchema - The resolved root schema definition.
 * @param fullSchema - The original schema containing definitions.
 * @returns An array of sort keys configurations keyed by path pattern.
 */
export const createSortKeysConfigs = (rootSchema: JSONSchema7, fullSchema: JSONSchema7): SortKeysConfig[] => {
	const configs: SortKeysConfig[] = [];
	// Prevents duplicate ESLint rules when multiple schema paths resolve to the same pattern.
	const seenPatterns = new Set<string>();

	const registerObjectConfig = (schema: JSONSchema7, path: PathSegment[]): void => {
		if (!hasProperties(schema)) {
			return;
		}

		const propertyNames = Object.keys(schema.properties);

		if (propertyNames.length === 0) {
			return;
		}

		const pattern = buildPathPattern(path);

		if (seenPatterns.has(pattern)) {
			return;
		}

		configs.push({
			pathPattern: pattern,
			order: generatePropertyOrder(schema),
		});

		seenPatterns.add(pattern);
	};

	const traverseObjectProperties = (schema: JSONSchema7, path: PathSegment[]): void => {
		if (!schema.properties) {
			return;
		}

		for (const [propertyName, definition] of Object.entries(schema.properties)) {
			const resolvedDefinition = resolveDefinition(definition);

			if (!resolvedDefinition) {
				continue;
			}

			traverseSchema(resolvedDefinition, [...path, { kind: 'literal', value: propertyName }]);
		}
	};

	const traverseAdditionalProperties = (schema: JSONSchema7, path: PathSegment[]): void => {
		if (!schema.additionalProperties || typeof schema.additionalProperties === 'boolean') {
			return;
		}

		const additional = resolveDefinition(schema.additionalProperties);

		if (additional) {
			traverseSchema(additional, [...path, WILDCARD_SEGMENT]);
		}
	};

	const traverseArrayItems = (schema: JSONSchema7, path: PathSegment[]): void => {
		const { items } = schema;

		if (!items) {
			return;
		}

		const itemSchemas = Array.isArray(items) ? items : [items];

		for (const item of itemSchemas) {
			const resolvedItem = resolveDefinition(item);

			if (!resolvedItem) {
				continue;
			}

			traverseSchema(resolvedItem, [...path, ARRAY_SEGMENT]);
		}
	};

	const traverseSchema = (schema: JSONSchema7, path: PathSegment[]): void => {
		const resolvedSchema = resolveRefLoop(fullSchema, schema);

		if (hasProperties(resolvedSchema)) {
			registerObjectConfig(resolvedSchema, path);
			traverseObjectProperties(resolvedSchema, path);
		}

		traverseAdditionalProperties(resolvedSchema, path);

		if (isArraySchema(resolvedSchema)) {
			traverseArrayItems(resolvedSchema, path);
		}
	};

	traverseSchema(rootSchema, []);

	return configs;
};

/**
 * Creates an ESLint instance configured for sorting JSONC files.
 *
 * @param sortKeysConfigs - The sort keys configuration.
 * @returns A configured ESLint instance.
 */
const createSortingESLint = (sortKeysConfigs: SortKeysConfig[]): ESLint => {
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
 * Sorts JSONC content using ESLint.
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
): Promise<{ output: string; result: ESLint.LintResult }> => {
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

	const output = result.output ?? content;

	return { output, result };
};

/**
 * Serves as the main entry point for CLI execution.
 */
const main = async (): Promise<void> => {
	const {
		values: { schema: schemaFilePathOverride, write: shouldWrite, help: showHelp, cwd: cwdOption },
		positionals,
	} = parseArgs({
		options: {
			schema: {
				type: 'string',
				short: 's',
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
			cwd: {
				type: 'string',
				short: 'c',
			},
		},
		strict: true,
		allowPositionals: true,
	});

	if (showHelp) {
		console.log(`
Usage: sort-wrangler-json [config] [options]

Arguments:
  config               Path to the configuration file (default: ./wrangler.jsonc)

Options:
  -c, --cwd <path>     Change the current working directory
  -s, --schema <path>  Override the schema file path (relative to the configuration file)
  -w, --write          Write the output to the original file
  -h, --help           Print help message

Examples:
  sort-wrangler-json                      # Display sorted output
  sort-wrangler-json -s schema.jsonc      # Use a custom schema file
  sort-wrangler-json -w                   # Sort and write to default file
  sort-wrangler-json config.jsonc -w      # Sort and write to specified file
  sort-wrangler-json -c ./my-project      # Run from a different directory
`);

		return;
	}

	if (cwdOption) {
		const cwdAbsolute = path.resolve(cwdOption);

		try {
			const stats = await stat(cwdAbsolute);

			if (!stats.isDirectory()) {
				throw new Error(`Path is not a directory: ${cwdAbsolute}`);
			}

			process.chdir(cwdAbsolute);
		} catch (error) {
			if (error instanceof Error && error.message.includes('ENOENT')) {
				throw new Error(`Directory not found: ${cwdAbsolute}`);
			}

			throw error;
		}
	}

	const configFilePath = positionals[0] ?? './wrangler.jsonc';

	const configContent = await readFile(configFilePath, 'utf-8');
	const ast = jsoncEslintParser.parseForESLint(configContent, {
		filePath: configFilePath,
	});
	const configDirectory = path.dirname(configFilePath);
	const schemaFilePath = schemaFilePathOverride ?? extractSchemaPath(ast);
	const schemaFilePathAbsolute = path.isAbsolute(schemaFilePath)
		? schemaFilePath
		: path.resolve(configDirectory, schemaFilePath);
	const schemaContent = await readFile(schemaFilePathAbsolute, 'utf-8');
	const schema: JSONSchema7 = JSON.parse(schemaContent);
	const rootSchema = extractRootSchema(schema);
	const sortKeysConfigs = createSortKeysConfigs(rootSchema, schema);
	const { output } = await sortJsoncContent(configContent, configFilePath, sortKeysConfigs);

	if (shouldWrite) {
		await writeFile(configFilePath, output, 'utf-8');
	} else {
		process.stdout.write(output);
	}
};

// Runs main only when the file executes as a script (not when imported as a module).
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error('Error:', error instanceof Error ? error.message : error);

		process.exit(1);
	});
}
