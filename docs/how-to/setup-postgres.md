# Setting Up PostgreSQL with Extensions

This guide covers setting up PostgreSQL with all required extensions for nexus-core.

## Required Extensions

nexus-core requires the following PostgreSQL extensions:

- **pgmq** - Message queue functionality
- **pg_cron** - In-database job scheduling
- **pg_partman** - Automated partition management
- **pg_stat_statements** - Query performance monitoring (included by default)

## Option 1: Docker Setup (Recommended)

The easiest way to get started is using Docker with the provided setup. This is the recommended approach, especially for Windows users.

### Prerequisites

- **Container Runtime** installed and running (choose one):
  - **Docker Desktop for Windows**: https://www.docker.com/products/docker-desktop
  - **containerd with nerdctl**: https://github.com/containerd/nerdctl
  - The setup script automatically detects which runtime you're using

### Quick Start

**Windows (PowerShell):**
```powershell
# Start PostgreSQL container with all extensions
.\scripts\setup-docker.ps1 -StartContainer

# Or use docker-compose directly
docker-compose up -d
```

**Linux/macOS:**
```bash
# Start PostgreSQL container
docker-compose up -d

# Check status
docker-compose ps
```

This will:
- Build a custom PostgreSQL 17 image with all extensions (takes 3-5 minutes first time)
- Start a container named `core-postgres` on port `6543`
- Create the `core` database
- Install all extensions automatically

**Connection Details:**
- **Host**: `localhost`
- **Port**: `6543`
- **Database**: `core`
- **User**: `postgres`
- **Password**: `postgres`
- **Connection URL**: `postgres://postgres:postgres@localhost:6543/core`

### Verify Setup

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

### Container Management

**Using the Setup Script (PowerShell):**

The script automatically detects whether you're using Docker or containerd:

```powershell
# Start container
.\scripts\setup-docker.ps1 -StartContainer

# Stop container
.\scripts\setup-docker.ps1 -StopContainer

# Remove container and volumes (deletes data)
.\scripts\setup-docker.ps1 -RemoveContainer

# Rebuild and start
.\scripts\setup-docker.ps1 -StartContainer -Rebuild

# Show logs
.\scripts\setup-docker.ps1 -ShowLogs

# Check status
.\scripts\setup-docker.ps1 -ShowStatus
```

**Using Docker Compose:**

```bash
# Start container
docker-compose up -d

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

**Using containerd (nerdctl):**

```bash
# Start container
nerdctl compose up -d

# Stop container
nerdctl compose stop

# Stop and remove container + volumes
nerdctl compose down -v

# View logs
nerdctl compose logs -f postgres
```

### Environment Configuration

Update your `.env` file:

```env
CORE_DATABASE_URL=postgres://postgres:postgres@localhost:6543/core
```

Or set it in PowerShell:

```powershell
$env:CORE_DATABASE_URL="postgres://postgres:postgres@localhost:6543/core"
```

### What Gets Installed

The Docker image includes:

1. **PostgreSQL 17** - Latest stable version
2. **pg_cron** - Installed via apt package (fast installation)
3. **pg_partman** - Installed via apt package (fast installation)
4. **pgmq** - Installed via PGXN (with source build fallback)
5. **pg_stat_statements** - Included with PostgreSQL by default

**Build Time**: ~2-3 minutes

See [`docker/BUILD_NOTES.md`](../../docker/BUILD_NOTES.md) for details on the extension installation strategy.

### Data Persistence

Data is stored in a Docker volume named `postgres_data`. This means:
- Data persists when you stop/start the container
- Data is removed only when you run `docker-compose down -v`
- Data survives Docker Desktop restarts

### Troubleshooting

#### "Container runtime is not running"
- **Docker**: Start Docker Desktop and wait for it to fully start (whale icon in system tray)
- **containerd**: Ensure containerd service is running
- Try again

#### "Port 6543 is already in use"
- Another service is using port 6543
- Stop it or change the port in `docker-compose.yml`:
  ```yaml
  ports:
    - "6544:5432"  # Use 6544 instead
  ```
- Update your `.env` accordingly

#### Extensions not showing up
- Check container logs: `docker logs core-postgres`
- Rebuild the container:
  ```powershell
  .\scripts\setup-docker.ps1 -RemoveContainer
  .\scripts\setup-docker.ps1 -StartContainer -Rebuild
  ```

#### Container won't start
- Check Docker Desktop logs
- Ensure you have enough disk space
- Try: `docker system prune` to clean up

#### Can't connect from host
- Ensure the container is running: `docker ps | Select-String core-postgres`
- Verify port 6543 is exposed
- Check firewall settings

#### Reset everything
```powershell
# Stop and remove container + volumes
docker-compose down -v

# Remove image (optional)
docker rmi core-test-postgres

# Start fresh
docker-compose up -d
```

### Production Considerations

This Docker setup is for **development only**. For production:

1. Change the default password
2. Use environment variables for sensitive data
3. Configure proper backup strategies
4. Use managed PostgreSQL services (AWS RDS, Azure Database, etc.) that support these extensions
5. Set up proper networking and security groups

## Option 2: Local PostgreSQL Installation

### Prerequisites

- PostgreSQL 17+ installed
- Superuser or database owner privileges
- Build tools (for compiling extensions)

### Installation Steps

#### Windows

1. **Install PostgreSQL 17** from [postgresql.org](https://www.postgresql.org/download/windows/)

2. **Install pg_cron and pg_partman** via PostgreSQL APT repository:
   ```powershell
   # These are typically available via package managers
   # Or use the installation script:
   .\scripts\install_extensions.ps1
   ```

3. **Install pgmq** via PGXN:
   ```powershell
   # Install PGXN client
   pip install pgxnclient
   
   # Install pgmq
   pgxn install pgmq
   ```

#### Linux (Ubuntu/Debian)

```bash
# Install PostgreSQL 17
sudo apt-get update
sudo apt-get install postgresql-17 postgresql-17-cron postgresql-17-partman

# Install PGXN client
sudo apt-get install pgxnclient

# Install pgmq
sudo pgxn install pgmq
```

#### macOS

```bash
# Using Homebrew
brew install postgresql@17

# Install extensions
brew install pgxnclient
pgxn install pgmq
```

### Create Database and Install Extensions

```sql
-- Connect as superuser
psql -U postgres

-- Create database
CREATE DATABASE core;

-- Connect to core database
\c core

-- Install extensions
CREATE EXTENSION IF NOT EXISTS pgmq;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_partman;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Verify installations
\dx
```

You should see all four extensions listed.

## Option 3: Manual Extension Installation

If package managers don't work, you can build from source.

### Building pgmq from Source

```bash
# Clone repository
git clone https://github.com/pgmq/pgmq.git
cd pgmq

# Build and install
make install

# In PostgreSQL
CREATE EXTENSION pgmq;
```

### Building pg_cron from Source

```bash
# Clone repository
git clone https://github.com/citusdata/pg_cron.git
cd pg_cron

# Build and install
make install

# In PostgreSQL
CREATE EXTENSION pg_cron;
```

## Verification

Verify all extensions are installed:

```sql
SELECT extname, extversion 
FROM pg_extension 
WHERE extname IN ('pgmq', 'pg_cron', 'pg_partman', 'pg_stat_statements');
```

Expected output:
```
    extname         | extversion
--------------------+------------
 pg_cron            | 1.6
 pg_partman         | 5.0
 pgmq               | 1.0
 pg_stat_statements | 1.10
```

## Configuration

### pg_cron Configuration

Add to `postgresql.conf`:

```conf
shared_preload_libraries = 'pg_cron'
cron.database_name = 'core'
```

Restart PostgreSQL after changing this.

### pgmq Configuration

No special configuration needed. Queues are created automatically.

### pg_partman Configuration

Partitioning is configured automatically by nexus-core. The `core.event_log` table is partitioned monthly with 6-month retention.

## Troubleshooting

### "Extension pgmq does not exist"

**Cause**: Extension not installed or not found in PostgreSQL's extension directory.

**Solution**:
1. Verify PostgreSQL version: `SELECT version();`
2. Check extension path: `SHOW sharedir;`
3. Ensure extension files are in `$sharedir/extension/`
4. Try installing via PGXN or from source

### "Permission denied to create extension"

**Cause**: Current user doesn't have superuser privileges.

**Solution**:
- Connect as superuser (usually `postgres` user)
- Or grant necessary privileges:
  ```sql
  GRANT CREATE ON DATABASE core TO your_user;
  ```

### "pg_cron: extension is not available"

**Cause**: `pg_cron` not loaded in `shared_preload_libraries`.

**Solution**:
1. Add to `postgresql.conf`:
   ```conf
   shared_preload_libraries = 'pg_cron'
   ```
2. Restart PostgreSQL
3. Verify: `SHOW shared_preload_libraries;`

### Port Conflicts

If port `5432` is already in use:
- Change Docker port mapping in `docker-compose.yml`
- Or configure PostgreSQL to use a different port

## Next Steps

Once PostgreSQL is set up:
1. Update your `.env` file with connection string
2. Run your application - nexus-core will initialize the schema automatically
3. See [Getting Started](../tutorials/getting-started.md) for next steps

## Additional Resources

- [PostgreSQL Extension Network (PGXN)](https://pgxn.org/)
- [pgmq Documentation](https://github.com/pgmq/pgmq)
- [pg_cron Documentation](https://github.com/citusdata/pg_cron)
- [pg_partman Documentation](https://github.com/pgpartman/pg_partman)

