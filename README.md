# `sort-wrangler-json`

A CLI tool to sort Wrangler configuration files written in JSON (`wrangler.json`) or JSONC (`wrangler.jsonc`) based on their schema definition. Comments in JSONC files are preserved.

> [!IMPORTANT]
> This package is not yet published to any registry. You can use it by cloning the repository and installing it by running `pnpm install && pnpm add --global .` in the project root.

## Features

- Sorts keys within the configuration based on the schema
- Sorts keys within the environment-specific configurations as well as the top-level one
- Places the `env` key at the end of the configuration for a clear inheritance hierarchy
- Preserves all comments
- Writes sorted output directly to the configuration file

## Usage

Sort the configuration file in place:

```shell
sort-wrangler-json [<CONFIG>] [OPTIONS]
```

### Parameters

| Parameter  | Type   | Description                            | Default            |
| ---------- | ------ | -------------------------------------- | ------------------ |
| `<CONFIG>` | string | Path to the configuration file to sort | `./wrangler.jsonc` |

Both `.json` and `.jsonc` files are supported. If `<CONFIG>` is omitted, the tool uses `./wrangler.jsonc`.

### Options

| Option         | Type    | Description                                                                   | Default     |
| -------------- | ------- | ----------------------------------------------------------------------------- | ----------- |
| `-c, --cwd`    | string  | Directory to run the command from (relative to the current working directory) | `undefined` |
| `-s, --schema` | string  | Path to the schema file to override (relative to the configuration file)      | `undefined` |
| `--check`      | boolean | Check whether the configuration is sorted without writing changes             | `false`     |
| `-h, --help`   | boolean | Whether to print the help message                                             | `false`     |

## How It Works

1. Reads the Wrangler configuration file from the current directory (or specified path)
2. Extracts the `$schema` key to locate the schema file
3. Dynamically builds an ESLint configuration with the [`jsonc/sort-keys`](https://ota-meshi.github.io/eslint-plugin-jsonc/rules/sort-keys.html) rule based on the schema
4. Applies ESLint's autofixes
5. Checks for sorting issues with `--check`, or writes the sorted output back to the original file by default
