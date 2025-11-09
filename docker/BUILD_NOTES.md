# Docker Build Notes

## Extension Installation Strategy

This Dockerfile uses a **hybrid approach** to install PostgreSQL extensions:

### Package-Based Installation (Fast)

The following extensions are installed via apt packages:
- **pg_cron**: `postgresql-17-cron` - Available in PostgreSQL APT repository
- **pg_partman**: `postgresql-17-partman` - Available in PostgreSQL APT repository

These packages are pre-built and tested, making installation much faster (seconds instead of minutes).

### PGXN/Source Build

The following extension is installed via PGXN with fallback to source build:
- **pgmq**: Installed via `pgxn install pgmq` - https://pgxn.org/dist/pgmq/
- Falls back to building from source (https://github.com/pgmq/pgmq) if PGXN fails

### pg_stat_statements

This extension is included with PostgreSQL by default and doesn't need separate installation.

## Build Time

- **Hybrid approach**: ~2-3 minutes
  - pg_cron and pg_partman: ~10 seconds (apt packages)
  - pgmq: ~2-3 minutes (PGXN or source build)

## Why This Approach?

1. **Speed**: Pre-built packages for pg_cron and pg_partman are much faster
2. **Reliability**: Packages are tested and maintained by PostgreSQL community
3. **Flexibility**: PGXN for pgmq provides easy installation with source fallback
4. **Best of both worlds**: Fast packages where available, flexible PGXN/source where needed

## PGXN Client

The PGXN client (`pgxnclient`) is installed via pip3. It requires:
- Python 3
- Build tools (build-essential, git, postgresql-server-dev-17, libpq-dev)

Build tools are removed after installation to keep the image size small.

## Troubleshooting

If PGXN installation fails:
1. Check internet connectivity during build
2. Verify PostgreSQL version compatibility
3. Check PGXN website for extension availability: https://pgxn.org/

## Alternative Installation Methods

If PGXN doesn't work for your use case, you can fall back to:
- **APT packages**: `postgresql-17-cron`, `postgresql-17-partman` (if available)
- **Manual build**: Clone repositories and build from source
- **SQL-only**: For pgmq, you can use SQL-only installation (see pgmq INSTALLATION.md)

