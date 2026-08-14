[CmdletBinding()]
param(
  [Parameter()]
  [string]$Email
)

$ErrorActionPreference = "Stop"
$agentsRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $agentsRoot "docker-compose.production.yml"
$envFile = Join-Path $agentsRoot ".env.production"

if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Missing $envFile. Prepare the free deployment environment first."
}

if ([string]::IsNullOrWhiteSpace($Email)) {
  $Email = Read-Host "Platform Super Admin email"
}
$Email = $Email.Trim().ToLowerInvariant()
if ($Email -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$' -or $Email.Length -gt 320) {
  throw "Enter a valid email address."
}

$securePassword = Read-Host "New Platform Super Admin password (12-200 characters)" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  if ($plainPassword.Length -lt 12 -or $plainPassword.Length -gt 200) {
    throw "Password must contain 12-200 characters."
  }

  $env:PLATFORM_BOOTSTRAP_EMAIL = $Email
  $env:PLATFORM_BOOTSTRAP_PASSWORD = $plainPassword

  Push-Location $agentsRoot
  try {
    & docker compose --env-file $envFile -f $composeFile run --rm --no-deps -T `
      -e PLATFORM_BOOTSTRAP_EMAIL `
      -e PLATFORM_BOOTSTRAP_PASSWORD `
      api node dist/scripts/bootstrap-platform-admin.js --mfa-enrolled
    if ($LASTEXITCODE -ne 0) {
      throw "Platform Super Admin bootstrap failed with exit code $LASTEXITCODE."
    }
  }
  finally {
    Pop-Location
  }
}
finally {
  Remove-Item Env:PLATFORM_BOOTSTRAP_EMAIL -ErrorAction SilentlyContinue
  Remove-Item Env:PLATFORM_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
  if ($null -ne $passwordPointer) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
  $plainPassword = $null
  $securePassword = $null
}

Write-Host "Platform Super Admin is ready. Sign in at /platform/login." -ForegroundColor Green
