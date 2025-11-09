# Database Connection Test Script
# Tests connectivity to the PostgreSQL container on port 6543

param(
    [string]$DbHost = "localhost",
    [int]$Port = 6543,
    [string]$Database = "core",
    [string]$User = "postgres",
    [string]$Password = "postgres"
)

$ErrorActionPreference = "Stop"

Write-Host "PostgreSQL Connection Test" -ForegroundColor Cyan
Write-Host "=========================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Testing connection to:" -ForegroundColor Yellow
Write-Host "  Host:     $DbHost" -ForegroundColor Gray
Write-Host "  Port:     $Port" -ForegroundColor Gray
Write-Host "  Database: $Database" -ForegroundColor Gray
Write-Host "  User:     $User" -ForegroundColor Gray
Write-Host ""

# Test 1: Check if port is listening
Write-Host "Test 1: Checking if port $Port is listening..." -ForegroundColor Yellow

# Check if we're trying localhost and might be in WSL2 scenario
if ($DbHost -eq "localhost") {
    $wslDistros = wsl --list --quiet 2>$null
    if ($wslDistros) {
        Write-Host "  Detected WSL2 - checking if containerd is running in WSL2..." -ForegroundColor Gray
        $wslIp = (wsl hostname -I 2>$null).Split()[0]
        if ($wslIp) {
            Write-Host "  WSL2 IP detected: $wslIp" -ForegroundColor Gray
            Write-Host "  Trying WSL2 IP as alternative..." -ForegroundColor Gray
        }
    }
}

try {
    $connection = Test-NetConnection -ComputerName $DbHost -Port $Port -WarningAction SilentlyContinue
    if ($connection.TcpTestSucceeded) {
        Write-Host "  ✓ Port $Port is open and accepting connections" -ForegroundColor Green
    }
    else {
        Write-Host "  ✗ Port $Port is not accessible on $DbHost" -ForegroundColor Red
        
        # If localhost failed and we have WSL2 IP, suggest using it
        if ($DbHost -eq "localhost" -and $wslIp) {
            Write-Host "" -ForegroundColor Yellow
            Write-Host "  Tip: Container may be running in WSL2. Try:" -ForegroundColor Yellow
            Write-Host "    .\scripts\test-database-connection.ps1 -DbHost $wslIp" -ForegroundColor Gray
            Write-Host "  Or set up port forwarding (see scripts/WSL2_PORT_FORWARDING.md)" -ForegroundColor Gray
        }
        else {
            Write-Host "    Error: Port not accessible" -ForegroundColor Red
            Write-Host "    Make sure the container is running: nerdctl ps | Select-String core-postgres" -ForegroundColor Yellow
        }
        exit 1
    }
}
catch {
    Write-Host "  ✗ Failed to test port: $_" -ForegroundColor Red
    Write-Host "    Make sure the container is running: nerdctl ps | Select-String core-postgres" -ForegroundColor Yellow
    
    if ($DbHost -eq "localhost" -and $wslIp) {
        Write-Host "    If using WSL2, try: .\scripts\test-database-connection.ps1 -DbHost $wslIp" -ForegroundColor Yellow
    }
    exit 1
}

Write-Host ""

# Test 2: Check if psql is available
Write-Host "Test 2: Checking if psql is available..." -ForegroundColor Yellow
$psqlPath = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psqlPath) {
    Write-Host "  ⚠ psql not found in PATH" -ForegroundColor Yellow
    Write-Host "    Skipping SQL tests. Install PostgreSQL client tools to run full tests." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Port test passed! Container appears to be running." -ForegroundColor Green
    exit 0
}
else {
    Write-Host "  ✓ psql found" -ForegroundColor Green
}

Write-Host ""

# Test 3: Test PostgreSQL connection
Write-Host "Test 3: Testing PostgreSQL connection..." -ForegroundColor Yellow
$env:PGPASSWORD = $Password
$connectionString = "postgres://${User}:${Password}@${DbHost}:${Port}/${Database}"

try {
    $result = psql $connectionString -c "SELECT version();" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ Successfully connected to PostgreSQL" -ForegroundColor Green
        $result | Select-String -Pattern "PostgreSQL" | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
    }
    else {
        Write-Host "  ✗ Failed to connect to PostgreSQL" -ForegroundColor Red
        Write-Host "    Error output:" -ForegroundColor Red
        $result | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
        exit 1
    }
}
catch {
    Write-Host "  ✗ Connection failed: $_" -ForegroundColor Red
    exit 1
}
finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

Write-Host ""

# Test 4: Check if database exists
Write-Host "Test 4: Verifying database '$Database' exists..." -ForegroundColor Yellow
try {
    $env:PGPASSWORD = $Password
    $result = psql $connectionString -c "SELECT current_database();" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ Database '$Database' is accessible" -ForegroundColor Green
    }
    else {
        Write-Host "  ✗ Database '$Database' not accessible" -ForegroundColor Red
        exit 1
    }
}
catch {
    Write-Host "  ✗ Failed to verify database: $_" -ForegroundColor Red
    exit 1
}
finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

Write-Host ""

# Test 5: Check extensions
Write-Host "Test 5: Verifying extensions are installed..." -ForegroundColor Yellow
$requiredExtensions = @("pg_cron", "pg_partman", "pgmq", "pg_stat_statements")
$missingExtensions = @()

try {
    $env:PGPASSWORD = $Password
    foreach ($ext in $requiredExtensions) {
        $result = psql $connectionString -t -c "SELECT COUNT(*) FROM pg_extension WHERE extname = '$ext';" 2>&1
        if ($LASTEXITCODE -eq 0) {
            $count = ($result -replace '\s', '')
            if ($count -eq "1") {
                Write-Host "  ✓ $ext is installed" -ForegroundColor Green
            }
            else {
                Write-Host "  ✗ $ext is NOT installed" -ForegroundColor Red
                $missingExtensions += $ext
            }
        }
        else {
            Write-Host "  ⚠ Could not check $ext" -ForegroundColor Yellow
        }
    }
}
catch {
    Write-Host "  ✗ Failed to check extensions: $_" -ForegroundColor Red
}
finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

Write-Host ""

# Summary
Write-Host "=========================" -ForegroundColor Cyan
if ($missingExtensions.Count -eq 0) {
    Write-Host "All tests passed! ✓" -ForegroundColor Green
    Write-Host ""
    Write-Host "Connection string:" -ForegroundColor Cyan
    Write-Host "  $connectionString" -ForegroundColor Gray
    exit 0
}
else {
    Write-Host "Tests completed with warnings" -ForegroundColor Yellow
    Write-Host "Missing extensions: $($missingExtensions -join ', ')" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Connection is working, but some extensions may need to be installed." -ForegroundColor Yellow
    exit 0
}

