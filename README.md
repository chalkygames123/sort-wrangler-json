# `sort-wrangler-jsonc`

A CLI tool to sort Wrangler configuration properties (JSONC format) based on their schema definition while preserving all original comments.

## Features

- Sorts properties in Wrangler configuration files according to the schema order
- Preserves all comments and formatting
- Moves `env` property to the end of the configuration
- Applies the same sorting rules to environment-specific configuration properties within `env`
- Supports both dry-run (output to stdout) and in-place write modes

## Requirements

- Node.js 23.6.0 or later

## Usage

Display sorted configuration to stdout:

```shell
npx sort-wrangler-jsonc
```

## Options

| Option            | Short | Type    | Description                         | Default            |
| ----------------- | ----- | ------- | ----------------------------------- | ------------------ |
| `--config <path>` | `-c`  | string  | Path to the configuration file      | `./wrangler.jsonc` |
| `--schema <path>` | `-s`  | string  | Override the schema file path       | `undefined`        |
| `--write`         | `-w`  | boolean | Write the sorted output to the file | `false`            |
| `--help`          | `-h`  | boolean | Display help message                | `false`            |

## How It Works

1. Reads the Wrangler configuration file from the current directory (or specified path)
2. Extracts the `$schema` property to locate the schema file
3. Dynamically constructs an ESLint configuration with the `jsonc/sort-keys` rule based on the schema
4. Applies automatic fixes using ESLint's Node.js API
5. Outputs the sorted result to stdout or writes it back to the file
