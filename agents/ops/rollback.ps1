[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$')]
  [string]$Release,
  [string]$EnvironmentFile = ".env.production"
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
if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) { throw "Environment file not found" }
if (-not (Test-Path -LiteralPath (Join-Path $root ".deployments\$Release.json") -PathType Leaf)) {
  throw "Unknown deployment release: $Release"
}

$env:APP_RELEASE = $Release
Push-Location $root
try {
  $images = docker compose --env-file $envPath -f $compose config --images | Sort-Object -Unique
  foreach ($image in $images) {
    docker image inspect $image *> $null
    if ($LASTEXITCODE -ne 0) { throw "Rollback image is unavailable locally: $image" }
  }
  docker compose --env-file $envPath -f $compose up -d --no-build --no-deps `
    api outbox-worker a1-worker a2-worker a3-worker analysis-worker frontend
  if ($LASTEXITCODE -ne 0) { throw "Application rollback failed" }

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
  if (-not $frontendHealthy) { throw "Rollback frontend health check did not become ready" }
  if (-not $apiHealthy) { throw "Rollback API readiness check did not become ready" }
  Write-Host "Application rollback PASS: $Release. Database schema was not reversed."
} finally {
  Remove-Item Env:APP_RELEASE -ErrorAction SilentlyContinue
  Pop-Location
}
