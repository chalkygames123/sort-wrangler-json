import { readFile } from 'node:fs/promises';
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

describe('sort-wrangler-jsonc', () => {
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

		test('should throw an error when properties cannot be extracted', () => {
			const schema: JSONSchema7 = {};

			expect(() => extractRootSchema(schema)).toThrow(
				'Unable to extract properties from the schema.',
			);
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

			expect(() => generatePropertyOrder(schema)).toThrow(
				'The root schema does not contain any properties.',
			);
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
	});

	describe('sortJsoncContent', () => {
		test('should sort JSONC content correctly', async () => {
			const content = `{
	"name": "test",
	"main": "index.js",
	"compatibility_date": "2025-01-01"
}`;
			const filePath = 'test.jsonc';
			const sortKeysConfigs = [
				{
					pathPattern: '^$',
					order: ['name', 'compatibility_date', 'main'],
				},
			];
			const { output } = await sortJsoncContent(
				content,
				filePath,
				sortKeysConfigs,
			);
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
			const originalConfigFilePath = path.join(
				import.meta.dirname,
				'test/fixtures',
				'wrangler.original.jsonc',
			);
			const expectedConfigFilePath = path.join(
				import.meta.dirname,
				'test/fixtures',
				'wrangler.expected.jsonc',
			);
			const originalConfigContent = await readFile(
				originalConfigFilePath,
				'utf-8',
			);
			const expectedConfigContent = await readFile(
				expectedConfigFilePath,
				'utf-8',
			);
			const configDirectory = path.dirname(originalConfigFilePath);
			const schemaFilePath = path.join(
				import.meta.dirname,
				'node_modules/wrangler/config-schema.json',
			);
			const schemaFilePathAbsolute = path.resolve(
				configDirectory,
				path.relative(configDirectory, schemaFilePath),
			);
			const schemaContent = await readFile(schemaFilePathAbsolute, 'utf-8');
			const schema: JSONSchema7 = JSON.parse(schemaContent);
			const rootSchema = extractRootSchema(schema);
			const sortKeysConfigs = createSortKeysConfigs(rootSchema, schema);
			const { output } = await sortJsoncContent(
				originalConfigContent,
				originalConfigFilePath,
				sortKeysConfigs,
			);

			expect(output).toBe(expectedConfigContent);
		});
	});
});
