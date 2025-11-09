# Docker Configuration

This directory contains Docker configuration files for running PostgreSQL with all required extensions.

## Quick Reference

- **Dockerfile**: `Dockerfile.postgres` - Custom PostgreSQL image with extensions
- **Docker Compose**: `docker-compose.yml` - Container orchestration
- **Init Script**: `postgres-init.sh` - Database initialization
- **Build Notes**: `BUILD_NOTES.md` - Extension installation strategy

## Documentation

For complete Docker setup instructions, see:
- **[Setting Up PostgreSQL](../docs/how-to/setup-postgres.md)** - Complete setup guide with Docker instructions

## Quick Start

```bash
# Start container
docker-compose up -d

# Or use the setup script (Windows)
.\scripts\setup-docker.ps1 -StartContainer
```

Connection: `postgres://postgres:postgres@localhost:6543/core`

## Files

- `Dockerfile.postgres` - Custom PostgreSQL 17 image with all extensions
- `docker-compose.yml` - Container configuration
- `postgres-init.sh` - Initialization script that creates database and installs extensions
- `BUILD_NOTES.md` - Technical notes on extension installation strategy

## Extension Installation Strategy

The Dockerfile uses a hybrid approach:
- **pg_cron** and **pg_partman**: Installed via apt packages (fast)
- **pgmq**: Installed via PGXN with source build fallback
- **pg_stat_statements**: Included with PostgreSQL by default

See [`BUILD_NOTES.md`](./BUILD_NOTES.md) for detailed information.
