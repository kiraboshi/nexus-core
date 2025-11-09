# Container Setup Script for Core Event System
# 
# This script sets up a PostgreSQL container with all required extensions.
# Supports both Docker and containerd (via nerdctl).
#
# Usage:
#   .\scripts\setup-docker.ps1
#   OR with parameters:
#   .\scripts\setup-docker.ps1 -StartContainer

param(
    [switch]$StartContainer = $false,
    [switch]$StopContainer = $false,
    [switch]$RemoveContainer = $false,
    [switch]$Rebuild = $false,
    [switch]$ShowLogs = $false,
    [switch]$ShowStatus = $false
)

$ErrorActionPreference = "Stop"

# Configuration
$ContainerName = "core-postgres"
$DatabaseUrl = "postgres://postgres:postgres@localhost:6543/core"
$ComposeFile = "docker-compose.yml"

Write-Host "Core Event System - Container Setup" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

# Detect container runtime (containerd/nerdctl or Docker)
$runtime = $null
$runtimeCmd = $null
$composeCmd = $null

# Check for nerdctl (containerd)
$nerdctlAvailable = Get-Command nerdctl -ErrorAction SilentlyContinue
if ($nerdctlAvailable) {
    try {
        nerdctl info | Out-Null
        $runtime = "containerd"
        $runtimeCmd = "nerdctl"
        Write-Host "Detected: containerd (via nerdctl)" -ForegroundColor Green
        
        # Check for nerdctl compose
        try {
            nerdctl compose version | Out-Null
            $composeCmd = "nerdctl compose"
            Write-Host "Using: nerdctl compose" -ForegroundColor Green
        }
        catch {
            Write-Host "Warning: nerdctl compose not available, trying nerdctl-compose" -ForegroundColor Yellow
            $composeCmd = "nerdctl-compose"
        }
    }
    catch {
        Write-Host "Warning: nerdctl found but containerd not running, trying Docker..." -ForegroundColor Yellow
    }
}

# Fall back to Docker if containerd not available
if (-not $runtime) {
    $dockerAvailable = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $dockerAvailable) {
        Write-Host "Error: No container runtime found" -ForegroundColor Red
        Write-Host ""
        Write-Host "Please install one of:" -ForegroundColor Yellow
        Write-Host "  - Docker Desktop: https://www.docker.com/products/docker-desktop" -ForegroundColor Yellow
        Write-Host "  - containerd with nerdctl: https://github.com/containerd/nerdctl" -ForegroundColor Yellow
        exit 1
    }
    
    # Check if Docker is running
    try {
        docker info | Out-Null
        $runtime = "docker"
        $runtimeCmd = "docker"
        Write-Host "Detected: Docker" -ForegroundColor Green
    }
    catch {
        Write-Host "Error: Docker is not running" -ForegroundColor Red
        Write-Host ""
        Write-Host "Please start Docker Desktop and try again." -ForegroundColor Yellow
        exit 1
    }
    
    # Check for docker-compose
    $composeAvailable = Get-Command docker-compose -ErrorAction SilentlyContinue
    if (-not $composeAvailable) {
        try {
            docker compose version | Out-Null
            $composeCmd = "docker compose"
            Write-Host "Using: docker compose (V2)" -ForegroundColor Green
        }
        catch {
            Write-Host "Error: docker compose not available" -ForegroundColor Red
            exit 1
        }
    }
    else {
        $composeCmd = "docker-compose"
        Write-Host "Using: docker-compose" -ForegroundColor Green
    }
}

Write-Host ""

function Show-Status {
    Write-Host "Checking container status..." -ForegroundColor Yellow
    Write-Host ""
    
    $runtimeArgs = @('ps', '-a', '--filter', "name=$ContainerName", '--format', '{{.Names}}\t{{.Status}}\t{{.Ports}}')
    $container = & $runtimeCmd $runtimeArgs
    if ($container) {
        Write-Host "Container Status:" -ForegroundColor Cyan
        Write-Host $container
        Write-Host ""
        
        # Check if container is healthy (Docker only, nerdctl may not support this)
        if ($runtime -eq "docker") {
            $inspectArgs = @('inspect', '--format={{.State.Health.Status}}', $ContainerName)
            $health = & $runtimeCmd $inspectArgs 2>$null
            if ($health) {
                Write-Host "Health Status: $health" -ForegroundColor $(if ($health -eq "healthy") { "Green" } else { "Yellow" })
            }
        }
    }
    else {
        Write-Host "Container '$ContainerName' not found" -ForegroundColor Yellow
    }
}

function Start-Container {
    Write-Host "Starting container..." -ForegroundColor Yellow
    Write-Host ""
    
    # Check if container already exists and is running
    $psArgs = @('ps', '--filter', "name=$ContainerName", '--format', '{{.Names}}')
    $existing = & $runtimeCmd $psArgs
    if ($existing -and -not $Rebuild) {
        Write-Host "Container '$ContainerName' is already running" -ForegroundColor Green
        return
    }
    
    # Check if container exists but is stopped
    $psAllArgs = @('ps', '-a', '--filter', "name=$ContainerName", '--format', '{{.Names}}')
    $stopped = & $runtimeCmd $psAllArgs
    
    if ($Rebuild) {
        # Rebuild requested - remove existing container and recreate
        if ($existing) {
            Write-Host "Stopping existing container for rebuild..." -ForegroundColor Yellow
            & $runtimeCmd stop $ContainerName | Out-Null
        }
        elseif ($stopped) {
            Write-Host "Removing stopped container for rebuild..." -ForegroundColor Yellow
        }
        
        if ($stopped -or $existing) {
            & $runtimeCmd rm $ContainerName | Out-Null
        }
        
        Write-Host "Rebuilding image..." -ForegroundColor Yellow
        $composeArgs = $composeCmd.Split(' ') + @('build', '--no-cache')
        & $composeArgs[0] $composeArgs[1..($composeArgs.Length-1)]
        
        # Recreate container with new image
        $composeArgs = $composeCmd.Split(' ') + @('up', '-d', '--force-recreate', '--remove-orphans')
        & $composeArgs[0] $composeArgs[1..($composeArgs.Length-1)]
    }
    elseif ($stopped) {
        # Container exists but is stopped - just start it
        Write-Host "Starting existing container..." -ForegroundColor Yellow
        & $runtimeCmd start $ContainerName | Out-Null
    }
    else {
        # Container doesn't exist - create it
        Write-Host "Creating new container..." -ForegroundColor Yellow
        $composeArgs = $composeCmd.Split(' ') + @('up', '-d')
        & $composeArgs[0] $composeArgs[1..($composeArgs.Length-1)]
    }
    
    Write-Host ""
    Write-Host "Waiting for PostgreSQL to be ready..." -ForegroundColor Yellow
    
    $maxAttempts = 30
    $attempt = 0
    $ready = $false
    
    while ($attempt -lt $maxAttempts) {
        Start-Sleep -Seconds 2
        $attempt++
        
        try {
            $execArgs = @('exec', $ContainerName, 'pg_isready', '-U', 'postgres', '-d', 'core')
            $result = & $runtimeCmd $execArgs 2>&1
            if ($LASTEXITCODE -eq 0) {
                $ready = $true
                break
            }
        }
        catch {
            # Continue waiting
        }
        
        Write-Host "." -NoNewline -ForegroundColor Gray
    }
    
    Write-Host ""
    
    if ($ready) {
        Write-Host "PostgreSQL is ready!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Connection details:" -ForegroundColor Cyan
        Write-Host "  URL: $DatabaseUrl" -ForegroundColor Gray
        Write-Host "  Host: localhost" -ForegroundColor Gray
        Write-Host "  Port: 6543" -ForegroundColor Gray
        Write-Host "  Database: core" -ForegroundColor Gray
        Write-Host "  User: postgres" -ForegroundColor Gray
        Write-Host "  Password: postgres" -ForegroundColor Gray
        Write-Host ""
        
        # Verify extensions
        Write-Host "Verifying extensions..." -ForegroundColor Yellow
        $execArgs = @('exec', $ContainerName, 'psql', '-U', 'postgres', '-d', 'core', '-c', '\dx')
        & $runtimeCmd $execArgs | Select-String -Pattern "pg_cron|pg_stat_statements|pg_partman|pgmq"
        
        Write-Host ""
        Write-Host "Setup complete! You can now use:" -ForegroundColor Green
        Write-Host "  CORE_DATABASE_URL=`"$DatabaseUrl`"" -ForegroundColor Gray
    }
    else {
        Write-Host "Warning: PostgreSQL may not be fully ready yet" -ForegroundColor Yellow
        Write-Host "Check logs with: $runtimeCmd logs $ContainerName" -ForegroundColor Yellow
    }
}

function Stop-Container {
    Write-Host "Stopping container..." -ForegroundColor Yellow
    & $runtimeCmd stop $ContainerName
    Write-Host "Container stopped" -ForegroundColor Green
}

function Remove-Container {
    Write-Host "Removing container and volumes..." -ForegroundColor Yellow
    
    # Stop container if running
    $psArgs = @('ps', '--filter', "name=$ContainerName", '--format', '{{.Names}}')
    $running = & $runtimeCmd $psArgs
    if ($running) {
        Write-Host "Stopping container..." -ForegroundColor Gray
        & $runtimeCmd stop $ContainerName | Out-Null
    }
    
    # Remove container
    $psAllArgs = @('ps', '-a', '--filter', "name=$ContainerName", '--format', '{{.Names}}')
    $exists = & $runtimeCmd $psAllArgs
    if ($exists) {
        Write-Host "Removing container..." -ForegroundColor Gray
        & $runtimeCmd rm -f $ContainerName | Out-Null
    }
    
    # Use compose to remove volumes
    try {
        $composeArgs = $composeCmd.Split(' ') + @('down', '-v')
        & $composeArgs[0] $composeArgs[1..($composeArgs.Length-1)] 2>&1 | Out-Null
    }
    catch {
        # Ignore compose errors - container is already removed
    }
    
    Write-Host "Container and volumes removed" -ForegroundColor Green
}

function Show-Logs {
    Write-Host "Showing container logs (Ctrl+C to exit)..." -ForegroundColor Yellow
    Write-Host ""
    $logsArgs = @('logs', '-f', $ContainerName)
    & $runtimeCmd $logsArgs
}

# Main logic
if ($ShowStatus) {
    Show-Status
}
elseif ($ShowLogs) {
    Show-Logs
}
elseif ($StopContainer) {
    Stop-Container
}
elseif ($RemoveContainer) {
    Remove-Container
}
else {
    Start-Container
}

