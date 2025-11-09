# Docker Setup for Core Event System

This directory contains Docker configuration files for running PostgreSQL with all required extensions.

## Quick Start

### Windows (PowerShell)

```powershell
# Start the container
.\scripts\setup-docker.ps1 -StartContainer

# Or use docker-compose directly
docker-compose up -d
```

### Linux/macOS

```bash
# Start the container
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f postgres
```

## What's Included

The Docker setup includes:

- **PostgreSQL 17** - Latest stable PostgreSQL version
- **pg_cron** - Installed via apt package (`postgresql-17-cron`) - fast installation
- **pg_partman** - Installed via apt package (`postgresql-17-partman`) - fast installation
- **pgmq** - Installed via PGXN (with source build fallback)
- **pg_stat_statements** - Included with PostgreSQL by default

**Build Time**: ~2-3 minutes

Extensions are installed using the fastest available method: apt packages for pg_cron and pg_partman, PGXN for pgmq. See `docker/BUILD_NOTES.md` for details on the installation strategy.

## Container Management

### Using the Setup Script (PowerShell)

The script automatically detects whether you're using Docker or containerd (via nerdctl):

```powershell
# Start container
.\scripts\setup-docker.ps1 -StartContainer

# Stop container
.\scripts\setup-docker.ps1 -StopContainer

# Remove container and volumes
.\scripts\setup-docker.ps1 -RemoveContainer

# Rebuild and start
.\scripts\setup-docker.ps1 -StartContainer -Rebuild

# Show logs
.\scripts\setup-docker.ps1 -ShowLogs

# Check status
.\scripts\setup-docker.ps1 -ShowStatus
```

### Using Docker Compose / nerdctl Compose

**For Docker:**
```bash
# Start container
docker-compose up -d
# OR (Docker Compose V2)
docker compose up -d

# Stop container
docker-compose stop

# Stop and remove container
docker-compose down

# Stop and remove container + volumes (deletes data)
docker-compose down -v

# Rebuild image
docker-compose build --no-cache

# View logs
docker-compose logs -f postgres

# Check status
docker-compose ps
```

**For containerd (nerdctl):**
```bash
# Start container
nerdctl compose up -d

# Stop container
nerdctl compose stop

# Stop and remove container
nerdctl compose down

# Stop and remove container + volumes (deletes data)
nerdctl compose down -v

# Rebuild image
nerdctl compose build --no-cache

# View logs
nerdctl compose logs -f postgres

# Check status
nerdctl compose ps
```

## Connection Details

Once the container is running:

- **Host**: `localhost`
- **Port**: `6543`
- **Database**: `core`
- **User**: `postgres`
- **Password**: `postgres`
- **Connection URL**: `postgres://postgres:postgres@localhost:6543/core`

## Environment Variables

Update your `.env` file:

```env
CORE_DATABASE_URL=postgres://postgres:postgres@localhost:6543/core
```

Or set it in PowerShell:

```powershell
$env:CORE_DATABASE_URL="postgres://postgres:postgres@localhost:6543/core"
```

## Verifying Extensions

Check that all extensions are installed:

```powershell
# Using psql
docker exec -it core-postgres psql -U postgres -d core -c "\dx"

# Or connect from your machine
psql "postgres://postgres:postgres@localhost:6543/core" -c "\dx"
```

You should see:
- `pg_cron`
- `pg_partman`
- `pgmq`
- `pg_stat_statements`

## Troubleshooting

### Container won't start

```powershell
# Check logs
docker logs core-postgres

# Check if port 6543 is already in use
netstat -ano | findstr :6543
```

### Extensions not installed

The extensions are installed during the first container startup. If they're missing:

1. Remove the container and volumes:
   ```powershell
   docker-compose down -v
   ```

2. Rebuild and start:
   ```powershell
   docker-compose build --no-cache
   docker-compose up -d
   ```

### Can't connect from host

Ensure the container is running and port 6543 is exposed:

```powershell
docker ps | Select-String core-postgres
```

### Reset everything

```powershell
# Stop and remove container + volumes
docker-compose down -v

# Remove image (optional)
docker rmi core-test-postgres

# Start fresh
docker-compose up -d
```

## Data Persistence

Data is stored in a Docker volume named `postgres_data`. To remove all data:

```powershell
docker-compose down -v
```

## Building the Image

The Dockerfile builds a custom PostgreSQL image with all extensions pre-installed. This takes several minutes on first build.

To rebuild:

```powershell
docker-compose build --no-cache
```

## Production Considerations

This setup is for **development only**. For production:

1. Change the default password
2. Use environment variables for sensitive data
3. Configure proper backup strategies
4. Use managed PostgreSQL services (AWS RDS, Azure Database, etc.) that support these extensions
5. Set up proper networking and security groups

