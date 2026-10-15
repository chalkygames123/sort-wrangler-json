# `sort-wrangler-json`

`sort-wrangler-json` sorts Wrangler configuration files. It supports JSON and JSONC files. It orders keys by the property order in a JSON Schema. It preserves comments in JSONC files.

## Install

Requires Node.js 24 or later.

The project does not publish this package to a package registry yet. Clone the repository. Run these commands in the project directory:

```shell
pnpm install
pnpm add --global .
```

## Features

- Sorts keys in the top-level configuration and nested objects.
- Sorts keys in environment-specific configurations.
- Places `env` last when the schema defines that key.
- Preserves comments in JSONC files.
- Writes sorted output to the configuration file by default.
- Checks key order without changing the file when you use `--check`.

## Use

```shell
sort-wrangler-json [<CONFIG>] [OPTIONS]
```

Sort the default file:

```shell
sort-wrangler-json
```

Sort a file that you specify:

```shell
sort-wrangler-json ./path/to/wrangler.jsonc
```

The tool supports `.json` and `.jsonc` files. If you omit `<CONFIG>`, the tool uses `./wrangler.jsonc`.

## Arguments

| Argument   | Type   | Description                      | Default            |
| ---------- | ------ | -------------------------------- | ------------------ |
| `<CONFIG>` | string | Path to the Wrangler config file | `./wrangler.jsonc` |

## Options

| Option       | Type    | Description                                      | Default                           |
| ------------ | ------- | ------------------------------------------------ | --------------------------------- |
| `-C`         | string  | Set the directory for this command               | Current working directory         |
| `--schema`   | string  | Set the JSON Schema file                         | The config file's `$schema` value |
| `--check`    | boolean | Check key order without changing the config file | `false`                           |
| `-h, --help` | boolean | Print help                                       | `false`                           |

The configuration file must have a string `$schema` value unless you use `--schema`. The tool uses that value to find the JSON Schema file.

The tool resolves a relative schema path from the configuration file's directory. This rule also applies to a path that you set with `--schema`.

The tool resolves a relative `-C` path from the directory where you start the command. The tool then resolves `<CONFIG>` from the new directory.

## Check key order

Use `--check` in a script or a continuous integration job:

```shell
sort-wrangler-json --check
```

The command exits with status `0` if the key order matches the schema. It prints a message to standard error and exits with status `1` if the key order does not match the schema. It does not change the file.

## Change behavior

Without `--check`, the tool writes the sorted output to the configuration file. It does not print the output to standard output. The tool overwrites the file.

Keep the file in version control or make a backup before you run the command. This lets you review or restore the original content.

The tool prints errors to standard error. It exits with a non-zero status if it cannot read or process the configuration or schema file.

## How the tool works

1. The tool reads the Wrangler configuration file.
2. The tool reads the schema path from `$schema`, or from `--schema`.
3. The tool reads the JSON Schema.
4. The tool uses the schema's property order to configure the [`jsonc/sort-keys` rule](https://ota-meshi.github.io/eslint-plugin-jsonc/rules/sort-keys.html).
5. The tool runs ESLint to sort the keys.
6. The tool checks the result when you use `--check`. Otherwise, it writes the result to the configuration file.
