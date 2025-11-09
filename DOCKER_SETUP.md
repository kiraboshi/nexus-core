# Docker Setup - Quick Start Guide

This guide will help you set up PostgreSQL with all required extensions using Docker on Windows.

## Prerequisites

- **Container Runtime** installed and running (choose one):
  - **Docker Desktop for Windows**: https://www.docker.com/products/docker-desktop
  - **containerd with nerdctl**: https://github.com/containerd/nerdctl
  - The script will automatically detect which runtime you're using

## Quick Start

### Step 1: Start the Container

Open PowerShell in the project directory and run:

```powershell
.\scripts\setup-docker.ps1 -StartContainer
```

This will:
1. Build a custom PostgreSQL image with all extensions (takes 3-5 minutes first time)
   - All extensions (pg_cron, pg_partman, pgmq) are installed via PGXN
   - PGXN provides consistent installation and handles dependencies automatically
2. Start a container named `core-postgres`
3. Create the `core` database
4. Install all required extensions automatically

### Step 2: Verify Setup

The script will show you when everything is ready. You can also verify manually:

```powershell
# Check container status
docker ps | Select-String core-postgres

# Verify extensions are installed
docker exec core-postgres psql -U postgres -d core -c "\dx"
```

You should see:
- `pg_cron`
- `pg_partman`
- `pgmq`
- `pg_stat_statements`

### Step 3: Update Your Environment

Your `.env` file should already have the correct connection string:

```env
CORE_DATABASE_URL=postgres://postgres:postgres@localhost:6543/core
```

If not, create/update `.env`:

```powershell
Copy-Item example.env .env
```

### Step 4: Run Your Application

```powershell
npm run build
npm start
```

## Container Management

### Start Container
```powershell
.\scripts\setup-docker.ps1 -StartContainer
# OR
docker-compose up -d
```

### Stop Container
```powershell
.\scripts\setup-docker.ps1 -StopContainer
# OR
docker-compose stop
```

### View Logs
```powershell
.\scripts\setup-docker.ps1 -ShowLogs
# OR
docker-compose logs -f postgres
```

### Remove Container (and all data)
```powershell
.\scripts\setup-docker.ps1 -RemoveContainer
# OR
docker-compose down -v
```

### Check Status
```powershell
.\scripts\setup-docker.ps1 -ShowStatus
# OR
docker-compose ps
```

## Connection Details

- **Host**: `localhost`
- **Port**: `6543`
- **Database**: `core`
- **User**: `postgres`
- **Password**: `postgres`
- **Connection URL**: `postgres://postgres:postgres@localhost:6543/core`

## Troubleshooting

### "Container runtime is not running"
- **Docker**: Start Docker Desktop and wait for it to fully start (whale icon in system tray)
- **containerd**: Ensure containerd service is running
- Try again

### "Port 6543 is already in use"
- Another service is using port 6543
- Stop it or change the port in `docker-compose.yml`:
  ```yaml
  ports:
    - "6544:5432"  # Use 6544 instead
  ```
- Update your `.env` accordingly

### Extensions not showing up
- Check container logs: `docker logs core-postgres`
- Rebuild the container:
  ```powershell
  .\scripts\setup-docker.ps1 -RemoveContainer
  .\scripts\setup-docker.ps1 -StartContainer -Rebuild
  ```

### Container won't start
- Check Docker Desktop logs
- Ensure you have enough disk space
- Try: `docker system prune` to clean up

## What Gets Installed

The Docker image includes:

1. **PostgreSQL 17** - Latest stable version
2. **pg_cron** - Installed via PGXN (PostgreSQL Extension Network)
3. **pg_partman** - Installed via PGXN
4. **pgmq** - Installed via PGXN
5. **pg_stat_statements** - Included with PostgreSQL by default

All extensions are installed using PGXN, which provides a consistent installation method and handles dependencies automatically. PGXN is the recommended installation method according to the extension maintainers.

## Data Persistence

Data is stored in a Docker volume named `postgres_data`. This means:
- Data persists when you stop/start the container
- Data is removed only when you run `docker-compose down -v`
- Data survives Docker Desktop restarts

## Next Steps

Once the container is running:

1. ✅ Extensions are installed
2. ✅ Database `core` is created
3. ✅ Ready to use with your application

Run your application and it will automatically:
- Connect to the database
- Create the core schema
- Set up queues and partitions
- Start processing events

## Additional Resources

- Full Docker documentation: `docker/README.md`
- Extension installation guide: `scripts/INSTALL_EXTENSIONS_WINDOWS.md`
- Main project README: `README.md`

