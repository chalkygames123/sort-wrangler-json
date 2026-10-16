import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import type { JSONSchema7 } from 'json-schema';

import {
	createSortKeysConfigs,
	extractRootSchema,
	generatePropertyOrder,
	resolveSchemaRef,
	sortJsoncContent,
} from './cli.ts';

void describe('sort-wrangler-json', () => {
	void describe('resolveSchemaRef', () => {
		void test('should resolve a schema reference', () => {
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

			assert.deepStrictEqual(result, {
				type: 'object',
				properties: {
					foo: { type: 'string' },
				},
			});
		});

		void test('should throw an error for invalid reference', () => {
			const schema: JSONSchema7 = {};

			assert.throws(() => resolveSchemaRef(schema, '#/invalid/ref'), {
				message: 'Unable to resolve schema reference: #/invalid/ref',
			});
		});
	});

	void describe('extractRootSchema', () => {
		void test('should extract root schema with properties', () => {
			const schema: JSONSchema7 = {
				properties: {
					name: { type: 'string' },
				},
			};

			const result = extractRootSchema(schema);

			assert.deepStrictEqual(result, schema);
		});

		void test('should resolve $ref and extract root schema', () => {
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

			assert.deepStrictEqual(result, {
				properties: {
					name: { type: 'string' },
				},
			});
		});

		void test('should resolve allOf references and extract root schema properties', () => {
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

			assert.deepStrictEqual(result.properties, {
				name: { type: 'string' },
			});
		});

		void test('should throw an error when properties cannot be extracted', () => {
			const schema: JSONSchema7 = {};

			assert.throws(() => extractRootSchema(schema), {
				message: 'Unable to extract properties from the schema.',
			});
		});
	});

	void describe('generatePropertyOrder', () => {
		void test('should generate property order with env at the end', () => {
			const schema: JSONSchema7 = {
				properties: {
					name: { type: 'string' },
					main: { type: 'string' },
					env: { type: 'object' },
					vars: { type: 'object' },
				},
			};

			const result = generatePropertyOrder(schema);

			assert.deepStrictEqual(result, ['name', 'main', 'vars', 'env']);
		});

		void test('should generate property order without env', () => {
			const schema: JSONSchema7 = {
				properties: {
					name: { type: 'string' },
					main: { type: 'string' },
				},
			};

			const result = generatePropertyOrder(schema);

			assert.deepStrictEqual(result, ['name', 'main']);
		});

		void test('should throw an error when properties do not exist', () => {
			const schema: JSONSchema7 = {};

			assert.throws(() => generatePropertyOrder(schema), {
				message: 'The root schema does not contain any properties.',
			});
		});
	});

	void describe('createSortKeysConfigs', () => {
		void test('should build configurations for nested schema paths', () => {
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

				assert.ok(match);

				if (!match) {
					throw new Error(`Configuration for pattern ${pattern} not found.`);
				}

				return match;
			};

			assert.deepStrictEqual(expectConfig(ROOT_PATTERN), {
				pathPattern: ROOT_PATTERN,
				order: ['foo', 'bar', 'baz', 'env'],
			});

			assert.deepStrictEqual(expectConfig(BAR_PATTERN), {
				pathPattern: BAR_PATTERN,
				order: ['second', 'first', 'nested'],
			});

			assert.deepStrictEqual(expectConfig(BAR_NESTED_PATTERN), {
				pathPattern: BAR_NESTED_PATTERN,
				order: ['delta', 'alpha'],
			});

			assert.deepStrictEqual(expectConfig(BAZ_ITEM_PATTERN), {
				pathPattern: BAZ_ITEM_PATTERN,
				order: ['z', 'a'],
			});

			assert.deepStrictEqual(expectConfig(ENV_ENV_PATTERN), {
				pathPattern: ENV_ENV_PATTERN,
				order: ['gamma', 'beta', 'list', 'nested'],
			});

			assert.deepStrictEqual(expectConfig(ENV_LIST_ITEM_PATTERN), {
				pathPattern: ENV_LIST_ITEM_PATTERN,
				order: ['z', 'a'],
			});
		});

		void test('should stop descending when schema definitions are recursive', () => {
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

			for (const expected of [
				{ pathPattern: '^$', order: ['previews'] },
				{ pathPattern: '^previews$', order: ['name', 'child'] },
				{ pathPattern: '^previews\\.child$', order: ['enabled', 'recursive'] },
				{ pathPattern: '^previews\\.child\\.recursive$', order: ['name', 'child'] },
			]) {
				assert.deepStrictEqual(
					configs.find((config) => config.pathPattern === expected.pathPattern),
					expected,
				);
			}

			assert.ok(!configs.some((config) => config.pathPattern === '^previews\\.child\\.recursive\\.child$'));
		});
	});

	void describe('sortJsoncContent', () => {
		for (const extension of ['jsonc', 'json']) {
			void test(`should sort ${extension} content correctly`, async () => {
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

				assert.strictEqual(output, expected);
			});
		}
	});

	void describe('integration test', () => {
		void test('should sort unsorted fixture to match sorted fixture', async () => {
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

			assert.strictEqual(output, expectedConfigContent);
		});

		void test('should run when invoked through a symlinked entry point', async () => {
			const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'sort-wrangler-json-'));

			const symlinkedCliPath = path.join(temporaryDirectory, 'cli.ts');

			await symlink(path.join(import.meta.dirname, 'cli.ts'), symlinkedCliPath);

			try {
				const result = spawnSync(process.execPath, [symlinkedCliPath, '--help'], {
					encoding: 'utf8',
				});

				assert.strictEqual(result.status, 0);

				assert.strictEqual(result.stderr, '');

				assert.ok(result.stdout.includes('Usage: sort-wrangler-json'));
			} finally {
				await rm(temporaryDirectory, { recursive: true, force: true });
			}
		});

		void test('should run from the directory specified with -C', async () => {
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

				assert.strictEqual(result.status, 0);

				assert.strictEqual(result.stderr, '');

				assert.strictEqual(await readFile(configFilePath, 'utf-8'), expectedConfig);
			} finally {
				await rm(temporaryDirectory, { recursive: true, force: true });
			}
		});

		void test('should write sorted output to the configuration file by default', async () => {
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

				assert.strictEqual(result.status, 0);

				assert.strictEqual(result.stderr, '');

				assert.strictEqual(result.stdout, '');

				assert.strictEqual(await readFile(configFilePath, 'utf-8'), expectedConfig);
			} finally {
				await rm(temporaryDirectory, { recursive: true, force: true });
			}
		});

		void test('should not write to the configuration file when it is already sorted', async () => {
			const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'sort-wrangler-json-'));

			const configFilePath = path.join(temporaryDirectory, 'wrangler.jsonc');

			const schemaFilePath = path.join(temporaryDirectory, 'schema.json');

			const sortedConfig = `{
	"name": "test",
	"main": "index.js"
}`;

			await writeFile(configFilePath, sortedConfig, 'utf-8');

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
				const previousModifiedAt = new Date('2000-01-01T00:00:00.000Z');

				await utimes(configFilePath, previousModifiedAt, previousModifiedAt);

				const modifiedAtBefore = (await stat(configFilePath, { bigint: true })).mtimeNs;

				const result = spawnSync(
					process.execPath,
					[path.join(import.meta.dirname, 'cli.ts'), 'wrangler.jsonc', '--schema', './schema.json'],
					{ cwd: temporaryDirectory, encoding: 'utf8' },
				);

				assert.strictEqual(result.status, 0);

				assert.strictEqual(result.stderr, '');

				assert.strictEqual(result.stdout, '');

				assert.strictEqual(await readFile(configFilePath, 'utf-8'), sortedConfig);

				assert.strictEqual((await stat(configFilePath, { bigint: true })).mtimeNs, modifiedAtBefore);
			} finally {
				await rm(temporaryDirectory, { recursive: true, force: true });
			}
		});

		void test('should check sorted output without writing to the configuration file', async () => {
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

				assert.strictEqual(unsortedResult.status, 1);

				assert.strictEqual(unsortedResult.stdout, '');

				assert.ok(unsortedResult.stderr.includes('Configuration is not sorted'));

				assert.strictEqual(await readFile(configFilePath, 'utf-8'), originalConfig);

				await writeFile(configFilePath, sortedConfig, 'utf-8');

				const sortedResult = runCheck();

				assert.strictEqual(sortedResult.status, 0);

				assert.strictEqual(sortedResult.stdout, '');

				assert.strictEqual(sortedResult.stderr, '');

				assert.strictEqual(await readFile(configFilePath, 'utf-8'), sortedConfig);
			} finally {
				await rm(temporaryDirectory, { recursive: true, force: true });
			}
		});
	});
});
