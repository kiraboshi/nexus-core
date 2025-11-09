#!/bin/bash
set -e

echo "=========================================="
echo "Initializing PostgreSQL extensions..."
echo "=========================================="

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL to be ready..."
until psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '\q' 2>/dev/null; do
  >&2 echo "PostgreSQL is unavailable - sleeping"
  sleep 1
done

echo "PostgreSQL is ready!"
echo ""
echo "Installing extensions..."

# Install extensions
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<-EOSQL
    -- Enable pg_stat_statements (usually already available)
    CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
    
    -- Enable pg_partman
    CREATE EXTENSION IF NOT EXISTS pg_partman;
    
    -- Enable pgmq
    CREATE EXTENSION IF NOT EXISTS pgmq;
    
    -- Enable pg_cron (may require restart if shared_preload_libraries wasn't set)
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    
    -- Verify installations
    SELECT 
        extname AS extension_name,
        extversion AS version
    FROM pg_extension
    WHERE extname IN ('pg_cron', 'pg_stat_statements', 'pg_partman', 'pgmq')
    ORDER BY extname;
EOSQL

echo ""
echo "=========================================="
echo "Extensions installed successfully!"
echo "=========================================="

