import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { JSONSchema7 } from 'json-schema';
import { describe, expect, test } from 'vitest';
import {
	createSortKeysConfigs,
	extractRootSchema,
	generatePropertyOrder,
	resolveSchemaRef,
	sortJsoncContent,
} from '../sort-wrangler-jsonc.js';

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
		test('should create sort keys configs for root and env', () => {
			const propertyOrder = ['name', 'main', 'env'];

			const result = createSortKeysConfigs(propertyOrder);

			expect(result).toEqual([
				{
					pathPattern: '^$',
					order: ['name', 'main', 'env'],
				},
				{
					pathPattern: '^env\\..+$',
					order: ['name', 'main', 'env'],
				},
			]);
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

			const { sortedContent } = await sortJsoncContent(
				content,
				filePath,
				sortKeysConfigs,
			);

			expect(sortedContent).toContain('"name"');
			expect(sortedContent).toContain('"compatibility_date"');
			expect(sortedContent).toContain('"main"');
			expect(sortedContent.indexOf('"name"')).toBeLessThan(
				sortedContent.indexOf('"compatibility_date"'),
			);
			expect(sortedContent.indexOf('"compatibility_date"')).toBeLessThan(
				sortedContent.indexOf('"main"'),
			);
		});
	});

	describe('integration test', () => {
		test('should sort unsorted fixture to match sorted fixture', async () => {
			const unsortedPath = join(
				import.meta.dirname,
				'fixtures',
				'wrangler.unsorted.jsonc',
			);
			const sortedPath = join(
				import.meta.dirname,
				'fixtures',
				'wrangler.sorted.jsonc',
			);

			const unsortedContent = await readFile(unsortedPath, 'utf-8');
			const expectedSorted = await readFile(sortedPath, 'utf-8');

			// Extract schema and generate property order (simplified for test)
			const sortKeysConfigs = createSortKeysConfigs([
				'$schema',
				'name',
				'compatibility_date',
				'compatibility_flags',
				'main',
				'routes',
				'logpush',
				'upload_source_maps',
				'assets',
				'observability',
				'vars',
				'services',
				'secrets_store_secrets',
				'env',
			]);

			const { sortedContent } = await sortJsoncContent(
				unsortedContent,
				unsortedPath,
				sortKeysConfigs,
			);

			expect(sortedContent).toBe(expectedSorted);
		});
	});
});
