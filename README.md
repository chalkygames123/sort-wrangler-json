# `sort-wrangler-json`

A CLI tool to sort Wrangler configuration files written in JSON format (`wrangler.json` or `wrangler.jsonc`) based on their schema definition while preserving all original comments.

> [!IMPORTANT]
> This package is not yet published to any registry. You can use it by cloning the repository and installing it by running `pnpm link` in the project root.

## Features

- Sorts keys within the configuration based on the schema
- Sorts keys within the environment-specific configurations as well as the top-level one
- Places the `env` key at the end of the configuration for a clear inheritance hierarchy
- Preserves all comments
- Supports both dry-run (write to stdout) and in-place editing modes

## Usage

Print the output of the sorting result to stdout:

```shell
npx sort-wrangler-json [<CONFIG>] [OPTIONS]
```

### Parameters

| Parameter  | Type   | Description                            | Default            |
| ---------- | ------ | -------------------------------------- | ------------------ |
| `<CONFIG>` | string | Path to the configuration file to sort | `./wrangler.jsonc` |

### Options

| Option         | Type    | Description                                                                   | Default     |
| -------------- | ------- | ----------------------------------------------------------------------------- | ----------- |
| `-c, --cwd`    | string  | Directory to run the command from (relative to the current working directory) | `undefined` |
| `-s, --schema` | string  | Path to the schema file to override (relative to the configuration file)      | `undefined` |
| `-w, --write`  | boolean | Whether to write the sorted output back to the file instead of stdout         | `false`     |
| `-h, --help`   | boolean | Whether to print the help message                                             | `false`     |

## How It Works

1. Reads the Wrangler configuration file from the current directory (or specified path)
2. Extracts the `$schema` key to locate the schema file
3. Dynamically builds an ESLint configuration with the [`jsonc/sort-keys`](https://ota-meshi.github.io/eslint-plugin-jsonc/rules/sort-keys.html) rule based on the schema
4. Applies ESLint's autofixes
5. Writes the output to stdout or the original file
