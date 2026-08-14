[CmdletBinding()]
param(
  [string]$EnvironmentFile = ".env.production",
  [switch]$SkipBackup,
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
$compose = Join-Path $root "docker-compose.production.yml"
$environmentPathInput = if ([System.IO.Path]::IsPathRooted($EnvironmentFile)) {
  $EnvironmentFile
} else {
  Join-Path $root $EnvironmentFile
}
$envPath = [System.IO.Path]::GetFullPath($environmentPathInput)

if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
  throw "Production environment file not found: $envPath"
}

Push-Location $root
try {
  pnpm.cmd exec tsx src/scripts/validate-phase11-production-config.ts --env $envPath
  if ($LASTEXITCODE -ne 0) { throw "Production configuration gate failed" }

  docker compose --env-file $envPath -f $compose config --quiet
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose configuration is invalid" }

  if ($ValidateOnly) {
    Write-Host "BuildWatch deployment validation PASS"
    return
  }

  $composeConfiguration = docker compose --env-file $envPath -f $compose config --format json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose project metadata is unavailable" }
  $projectName = $composeConfiguration.name
  $existingDatabaseContainer = docker compose --env-file $envPath -f $compose ps -a -q postgres
  if ($LASTEXITCODE -ne 0) { throw "Database container state is unavailable" }
  $existingDatabaseVolume = docker volume ls -q `
    --filter "label=com.docker.compose.project=$projectName" `
    --filter "label=com.docker.compose.volume=postgres-data"
  if ($LASTEXITCODE -ne 0) { throw "Database volume state is unavailable" }
  $existingDatabase = [bool]($existingDatabaseContainer -or $existingDatabaseVolume)
  $backupTaken = $false
  if ($existingDatabase -and -not $SkipBackup) {
    docker compose --env-file $envPath -f $compose --profile operations build operations
    if ($LASTEXITCODE -ne 0) { throw "Backup operations image build failed" }
    docker compose --env-file $envPath -f $compose --profile operations run --rm operations
    if ($LASTEXITCODE -ne 0) { throw "Pre-deployment backup failed" }
    $backupTaken = $true
  } elseif ($existingDatabase -and $SkipBackup) {
    Write-Warning "Existing database detected; backup was explicitly skipped."
  }

  docker compose --env-file $envPath -f $compose build --pull
  if ($LASTEXITCODE -ne 0) { throw "Production image build failed" }
  docker compose --env-file $envPath -f $compose up -d --remove-orphans
  if ($LASTEXITCODE -ne 0) { throw "Production deployment failed" }

  $settings = @{}
  Get-Content -LiteralPath $envPath | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') { $settings[$matches[1].Trim()] = $matches[2].Trim() }
  }
  $port = if ($settings.ContainsKey("BUILDWATCH_HTTP_PORT")) { $settings["BUILDWATCH_HTTP_PORT"] } else { "8080" }
  $frontendHealthy = $false
  $apiHealthy = $false
  for ($attempt = 1; $attempt -le 60; $attempt++) {
    try {
      $frontend = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$port/health/live" -TimeoutSec 3
      $api = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$port/api/health/ready" -TimeoutSec 3
      $frontendHealthy = $frontend.StatusCode -eq 200
      $apiHealthy = $api.StatusCode -eq 200
      if ($frontendHealthy -and $apiHealthy) { break }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  if (-not $frontendHealthy) { throw "Frontend health check did not become ready" }
  if (-not $apiHealthy) { throw "API readiness check did not become ready" }

  $deploymentDirectory = Join-Path $root ".deployments"
  New-Item -ItemType Directory -Path $deploymentDirectory -Force | Out-Null
  $release = $settings["APP_RELEASE"]
  $record = [ordered]@{
    release = $release
    deployedAt = [DateTime]::UtcNow.ToString("o")
    backupSkipped = [bool]$SkipBackup
    backupTaken = $backupTaken
    composeSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $compose).Hash.ToLowerInvariant()
  }
  $record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $deploymentDirectory "$release.json") -Encoding utf8
  Write-Host "BuildWatch deployment PASS: $release"
} finally {
  Pop-Location
}
