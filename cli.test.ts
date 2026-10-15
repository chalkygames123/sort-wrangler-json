import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { JSONSchema7 } from 'json-schema';
import { describe, expect, test } from 'vitest';

import {
	createSortKeysConfigs,
	extractRootSchema,
	generatePropertyOrder,
	resolveSchemaRef,
	sortJsoncContent,
} from './cli';

describe('sort-wrangler-json', () => {
	describe('resolveSchemaRef', () => {
		test('should resolve a schema reference', () => {
			const schema: JSONSchema7 = {
				definitions: {
					TestConfig: {
						type: 'object',
						properties: {
							foo: { type: 'string' },
						},
					},
				},
			};

			const result = resolveSchemaRef(schema, '#/definitions/TestConfig');

			expect(result).toEqual({
				type: 'object',
				properties: {
					foo: { type: 'string' },
				},
			});
		});

		test('should throw an error for invalid reference', () => {
			const schema: JSONSchema7 = {};

			expect(() => resolveSchemaRef(schema, '#/invalid/ref')).toThrow(
				'Unable to resolve schema reference: #/invalid/ref',
			);
		});
	});

	describe('extractRootSchema', () => {
		test('should extract root schema with properties', () => {
			const schema: JSONSchema7 = {
				properties: {
					name: { type: 'string' },
				},
			};

			const result = extractRootSchema(schema);

			expect(result).toEqual(schema);
		});

		test('should resolve $ref and extract root schema', () => {
			const schema: JSONSchema7 = {
				$ref: '#/definitions/RawConfig',
				definitions: {
					RawConfig: {
						properties: {
							name: { type: 'string' },
						},
					},
				},
			};

			const result = extractRootSchema(schema);

			expect(result).toEqual({
				properties: {
					name: { type: 'string' },
				},
			});
		});

		test('should resolve allOf references and extract root schema properties', () => {
			const schema: JSONSchema7 = {
				definitions: {
					RawConfig: {
						properties: {
							name: { type: 'string' },
						},
					},
				},
				allOf: [{ $ref: '#/definitions/RawConfig' }],
			};

			const result = extractRootSchema(schema);

			expect(result.properties).toEqual({
				name: { type: 'string' },
			});
		});

		test('should throw an error when properties cannot be extracted', () => {
			const schema: JSONSchema7 = {};

			expect(() => extractRootSchema(schema)).toThrow('Unable to extract properties from the schema.');
		});
	});

	describe('generatePropertyOrder', () => {
		test('should generate property order with env at the end', () => {
			const schema: JSONSchema7 = {
				properties: {
					name: { type: 'string' },
					main: { type: 'string' },
					env: { type: 'object' },
					vars: { type: 'object' },
				},
			};

			const result = generatePropertyOrder(schema);

			expect(result).toEqual(['name', 'main', 'vars', 'env']);
		});

		test('should generate property order without env', () => {
			const schema: JSONSchema7 = {
				properties: {
					name: { type: 'string' },
					main: { type: 'string' },
				},
			};

			const result = generatePropertyOrder(schema);

			expect(result).toEqual(['name', 'main']);
		});

		test('should throw an error when properties do not exist', () => {
			const schema: JSONSchema7 = {};

			expect(() => generatePropertyOrder(schema)).toThrow('The root schema does not contain any properties.');
		});
	});

	describe('createSortKeysConfigs', () => {
		test('should build configurations for nested schema paths', () => {
			const schema: JSONSchema7 = {
				definitions: {
					Nested: {
						type: 'object',
						properties: {
							delta: { type: 'string' },
							alpha: { type: 'string' },
						},
					},
					ListEntry: {
						type: 'object',
						properties: {
							z: { type: 'string' },
							a: { type: 'string' },
						},
					},
					EnvConfig: {
						type: 'object',
						properties: {
							gamma: { type: 'string' },
							beta: { type: 'string' },
							list: {
								type: 'array',
								items: { $ref: '#/definitions/ListEntry' },
							},
							nested: { $ref: '#/definitions/Nested' },
						},
					},
				},
				properties: {
					foo: { type: 'string' },
					bar: {
						type: 'object',
						properties: {
							second: { type: 'string' },
							first: { type: 'string' },
							nested: { $ref: '#/definitions/Nested' },
						},
					},
					baz: {
						type: 'array',
						items: { $ref: '#/definitions/ListEntry' },
					},
					env: {
						type: 'object',
						additionalProperties: { $ref: '#/definitions/EnvConfig' },
					},
				},
			};

			const rootSchema = extractRootSchema(schema);

			const configs = createSortKeysConfigs(rootSchema, schema);

			const ROOT_PATTERN = '^$';

			const BAR_PATTERN = '^bar$';

			const BAR_NESTED_PATTERN = '^bar\\.nested$';

			const BAZ_ITEM_PATTERN = '^baz\\[[0-9]+\\]$';

			const ENV_ENV_PATTERN = '^env\\.[^.]+$';

			const ENV_LIST_ITEM_PATTERN = '^env\\.[^.]+\\.list\\[[0-9]+\\]$';

			const expectConfig = (pattern: string) => {
				const match = configs.find((config) => config.pathPattern === pattern);

				expect(match).toBeDefined();

				if (!match) {
					throw new Error(`Configuration for pattern ${pattern} not found.`);
				}

				return match;
			};

			expect(expectConfig(ROOT_PATTERN)).toMatchObject({
				order: ['foo', 'bar', 'baz', 'env'],
			});

			expect(expectConfig(BAR_PATTERN)).toMatchObject({
				order: ['second', 'first', 'nested'],
			});

			expect(expectConfig(BAR_NESTED_PATTERN)).toMatchObject({
				order: ['delta', 'alpha'],
			});

			expect(expectConfig(BAZ_ITEM_PATTERN)).toMatchObject({
				order: ['z', 'a'],
			});

			expect(expectConfig(ENV_ENV_PATTERN)).toMatchObject({
				order: ['gamma', 'beta', 'list', 'nested'],
			});

			expect(expectConfig(ENV_LIST_ITEM_PATTERN)).toMatchObject({
				order: ['z', 'a'],
			});
		});

		test('should stop descending when schema definitions are recursive', () => {
			const schema: JSONSchema7 = {
				definitions: {
					RecursiveConfig: {
						type: 'object',
						properties: {
							name: { type: 'string' },
							child: { $ref: '#/definitions/NestedConfig' },
						},
					},
					NestedConfig: {
						type: 'object',
						properties: {
							enabled: { type: 'boolean' },
							recursive: { $ref: '#/definitions/RecursiveConfig' },
						},
					},
				},
				properties: {
					previews: { $ref: '#/definitions/RecursiveConfig' },
				},
			};

			const rootSchema = extractRootSchema(schema);

			const configs = createSortKeysConfigs(rootSchema, schema);

			expect(configs).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						pathPattern: '^$',
						order: ['previews'],
					}),
					expect.objectContaining({
						pathPattern: '^previews$',
						order: ['name', 'child'],
					}),
					expect.objectContaining({
						pathPattern: '^previews\\.child$',
						order: ['enabled', 'recursive'],
					}),
					expect.objectContaining({
						pathPattern: '^previews\\.child\\.recursive$',
						order: ['name', 'child'],
					}),
				]),
			);

			expect(configs).not.toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						pathPattern: '^previews\\.child\\.recursive\\.child$',
					}),
				]),
			);
		});
	});

	describe('sortJsoncContent', () => {
		test.each(['jsonc', 'json'])('should sort %s content correctly', async (extension) => {
			const content = `{
	"name": "test",
	"main": "index.js",
	"compatibility_date": "2025-01-01"
}`;

			const filePath = `test.${extension}`;

			const sortKeysConfigs = [
				{
					pathPattern: '^$',
					order: ['name', 'compatibility_date', 'main'],
				},
			];

			const { output } = await sortJsoncContent(content, filePath, sortKeysConfigs);

			const expected = `{
	"name": "test",
	"compatibility_date": "2025-01-01",
	"main": "index.js"
}`;

			expect(output).toBe(expected);
		});
	});

	describe('integration test', () => {
		test('should sort unsorted fixture to match sorted fixture', async () => {
			const configFilePath = path.join(import.meta.dirname, 'test/fixtures', 'wrangler.original.jsonc');

			const configContent = await readFile(configFilePath, 'utf-8');

			const configDirectory = path.dirname(configFilePath);

			const schemaFilePath = path.join(import.meta.dirname, 'node_modules/wrangler/config-schema.json');

			const schemaFilePathAbsolute = path.resolve(configDirectory, path.relative(configDirectory, schemaFilePath));

			const schemaContent = await readFile(schemaFilePathAbsolute, 'utf-8');

			const schema: JSONSchema7 = JSON.parse(schemaContent);

			const rootSchema = extractRootSchema(schema);

			const sortKeysConfigs = createSortKeysConfigs(rootSchema, schema);

			const { output } = await sortJsoncContent(configContent, configFilePath, sortKeysConfigs);

			const expectedConfigFilePath = path.join(import.meta.dirname, 'test/fixtures', 'wrangler.expected.jsonc');

			const expectedConfigContent = await readFile(expectedConfigFilePath, 'utf-8');

			expect(output).toBe(expectedConfigContent);
		});

		test('should run when invoked through a symlinked entry point', async () => {
			const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'sort-wrangler-json-'));

			const symlinkedCliPath = path.join(temporaryDirectory, 'cli.ts');

			await symlink(path.join(import.meta.dirname, 'cli.ts'), symlinkedCliPath);

			try {
				const result = spawnSync(process.execPath, [symlinkedCliPath, '--help'], {
					encoding: 'utf8',
				});

				expect(result.status).toBe(0);

				expect(result.stderr).toBe('');

				expect(result.stdout).toContain('Usage: sort-wrangler-json');
			} finally {
				await rm(temporaryDirectory, { recursive: true, force: true });
			}
		});

		test('should run from the directory specified with -C', async () => {
			const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'sort-wrangler-json-'));

			const configFilePath = path.join(temporaryDirectory, 'wrangler.jsonc');

			const schemaFilePath = path.join(temporaryDirectory, 'schema.json');

			const originalConfig = `{
	"main": "index.js",
	"name": "test"
}`;

			const expectedConfig = `{
	"name": "test",
	"main": "index.js"
}`;

			await writeFile(configFilePath, originalConfig, 'utf-8');

			await writeFile(
				schemaFilePath,
				JSON.stringify({
					properties: {
						name: { type: 'string' },
						main: { type: 'string' },
					},
				}),
				'utf-8',
			);

			try {
				const result = spawnSync(
					process.execPath,
					[path.join(import.meta.dirname, 'cli.ts'), '-C', temporaryDirectory, '--schema', './schema.json'],
					{ encoding: 'utf8' },
				);

				expect(result.status).toBe(0);

				expect(result.stderr).toBe('');

				expect(await readFile(configFilePath, 'utf-8')).toBe(expectedConfig);
			} finally {
				await rm(temporaryDirectory, { recursive: true, force: true });
			}
		});

		test('should write sorted output to the configuration file by default', async () => {
			const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'sort-wrangler-json-'));

			const configFilePath = path.join(temporaryDirectory, 'wrangler.jsonc');

			const schemaFilePath = path.join(temporaryDirectory, 'schema.json');

			const originalConfig = `{
	"main": "index.js",
	"name": "test"
}`;

			const expectedConfig = `{
	"name": "test",
	"main": "index.js"
}`;

			await writeFile(configFilePath, originalConfig, 'utf-8');

			await writeFile(
				schemaFilePath,
				JSON.stringify({
					properties: {
						name: { type: 'string' },
						main: { type: 'string' },
					},
				}),
				'utf-8',
			);

			try {
				const result = spawnSync(
					process.execPath,
					[path.join(import.meta.dirname, 'cli.ts'), 'wrangler.jsonc', '--schema', './schema.json'],
					{ cwd: temporaryDirectory, encoding: 'utf8' },
				);

				expect(result.status).toBe(0);

				expect(result.stderr).toBe('');

				expect(result.stdout).toBe('');

				expect(await readFile(configFilePath, 'utf-8')).toBe(expectedConfig);
			} finally {
				await rm(temporaryDirectory, { recursive: true, force: true });
			}
		});

		test('should check sorted output without writing to the configuration file', async () => {
			const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'sort-wrangler-json-'));

			const configFilePath = path.join(temporaryDirectory, 'wrangler.jsonc');

			const schemaFilePath = path.join(temporaryDirectory, 'schema.json');

			const originalConfig = `{
	"main": "index.js",
	"name": "test"
}`;

			const sortedConfig = `{
	"name": "test",
	"main": "index.js"
}`;

			await writeFile(configFilePath, originalConfig, 'utf-8');

			await writeFile(
				schemaFilePath,
				JSON.stringify({
					properties: {
						name: { type: 'string' },
						main: { type: 'string' },
					},
				}),
				'utf-8',
			);

			try {
				const cliPath = path.join(import.meta.dirname, 'cli.ts');

				const runCheck = () =>
					spawnSync(process.execPath, [cliPath, 'wrangler.jsonc', '--schema', './schema.json', '--check'], {
						cwd: temporaryDirectory,
						encoding: 'utf8',
					});

				const unsortedResult = runCheck();

				expect(unsortedResult.status).toBe(1);

				expect(unsortedResult.stdout).toBe('');

				expect(unsortedResult.stderr).toContain('Configuration is not sorted');

				expect(await readFile(configFilePath, 'utf-8')).toBe(originalConfig);

				await writeFile(configFilePath, sortedConfig, 'utf-8');

				const sortedResult = runCheck();

				expect(sortedResult.status).toBe(0);

				expect(sortedResult.stdout).toBe('');

				expect(sortedResult.stderr).toBe('');

				expect(await readFile(configFilePath, 'utf-8')).toBe(sortedConfig);
			} finally {
				await rm(temporaryDirectory, { recursive: true, force: true });
			}
		});
	});
});
