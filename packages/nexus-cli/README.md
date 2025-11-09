# Nexus CLI

A menu-driven CLI tool for quickly interrogating the core database using an interactive terminal interface built with [Ink](https://github.com/vadimdemedes/ink).

## Features

- **Database Tables Viewer**: Browse all tables in the core, pgmq, cron, and partman schemas
- **SQL Query Runner**: Execute pre-defined SQL queries or run custom queries
- **System Metrics**: View queue depths, dead letter queue status, and registered nodes

## Usage

```bash
npm run nexus
```

Or from the workspace root:
```bash
npm run nexus
```

The CLI will connect to the database using the `CORE_DATABASE_URL` environment variable (defaults to `postgres://postgres:postgres@localhost:5432/core`).

## Navigation

- Use **arrow keys** to navigate menus
- Press **Enter** to select an option
- Press **ESC** to go back to the main menu
- Press **Q** to quit

## Environment Variables

- `CORE_DATABASE_URL`: PostgreSQL connection string (default: `postgres://postgres:postgres@localhost:5432/core`)
- `CORE_NAMESPACE`: Namespace to use (default: `demo`)

