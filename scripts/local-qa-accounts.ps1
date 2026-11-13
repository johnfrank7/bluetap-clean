param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Initialize', 'Apply', 'RepairProfile', 'CopyEmail', 'CopyPassword', 'Load')]
  [string]$Action,
  [ValidateSet('requester', 'distributor', 'manager', 'admin')]
  [string]$Role
)

$ErrorActionPreference = 'Stop'
$qaRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$store = Join-Path $qaRoot '.env.local-qa-accounts'
$roles = @('requester', 'distributor', 'manager', 'admin')

function Read-QaAccounts {
  if (-not (Test-Path -LiteralPath $store -PathType Leaf)) { throw 'The private local-QA account store does not exist.' }
  $secure = Get-Content -LiteralPath $store -Raw | ConvertTo-SecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) | ConvertFrom-Json) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

if ($Action -eq 'CopyEmail' -or $Action -eq 'CopyPassword') {
  if (-not $Role) { throw 'Choose a role with -Role.' }
  $accounts = Read-QaAccounts
  $field = if ($Action -eq 'CopyEmail') { 'email' } else { 'password' }
  Set-Clipboard -Value ([string]$accounts.$Role.$field)
  Write-Host 'Copied the requested local-QA value to your clipboard.'
  return
}

if ($Action -eq 'Load') {
  $accounts = Read-QaAccounts
  foreach ($name in $roles) {
    [Environment]::SetEnvironmentVariable("BLUETAP_QA_$($name.ToUpper())_EMAIL", [string]$accounts.$name.email, 'Process')
    [Environment]::SetEnvironmentVariable("BLUETAP_QA_$($name.ToUpper())_PASSWORD", [string]$accounts.$name.password, 'Process')
    [Environment]::SetEnvironmentVariable("BLUETAP_QA_$($name.ToUpper())_UID", [string]$accounts.$name.uid, 'Process')
  }
  $env:BLUETAP_QA_REUSABLE_ACCOUNTS = '1'
  return
}

foreach ($name in @('FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'EMAIL_PROVIDER', 'RESEND_API_KEY', 'VERCEL_MAIL_RELAY_URL', 'INTERNAL_MAIL_RELAY_SECRET', 'EMAIL_FROM_ADDRESS', 'DEEPFACE_API_URL', 'DEEPFACE_API_KEY', 'RENDER_EXTERNAL_HOSTNAME', 'RENDER_SERVICE_NAME', 'VERCEL_URL')) {
  if ([Environment]::GetEnvironmentVariable($name, 'Process')) { throw 'Local account setup cannot use hosted credentials or services.' }
}
$expected = @{
  APP_ENV = 'local-qa'; LOCAL_QA_EMULATORS = '1'; FIREBASE_PROJECT_ID = 'demo-bluetap-local-qa';
  GCLOUD_PROJECT = 'demo-bluetap-local-qa'; FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'; FIREBASE_WEB_API_KEY = 'fake-local-qa-key'
}
foreach ($name in $expected.Keys) {
  $current = [Environment]::GetEnvironmentVariable($name, 'Process')
  if ($current -and $current -ne $expected[$name]) { throw 'Conflicting local-QA environment; no account was modified.' }
  [Environment]::SetEnvironmentVariable($name, $expected[$name], 'Process')
}
$env:EMAIL_OTP_HASH_SECRET = 'synthetic-local-qa-only'
$env:BLUETAP_QA_ACCOUNT_SETUP = '1'
$helper = Join-Path $qaRoot 'scripts/local-qa-reusable-accounts.js'

if ($Action -eq 'Initialize') {
  if (Test-Path -LiteralPath $store) { throw 'The private account store already exists; it will not be overwritten.' }
  $result = & node $helper discover
  if ($LASTEXITCODE -ne 0) { throw 'Could not find the existing four-role local fixture.' }
  $accounts = $result | ConvertFrom-Json
  foreach ($name in $roles) {
    $bytes = New-Object byte[] 24
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes) } finally { $random.Dispose() }
    $password = 'Aa1!' + [Convert]::ToBase64String($bytes)
    $accounts.$name | Add-Member -NotePropertyName password -NotePropertyValue $password
  }
  $json = $accounts | ConvertTo-Json -Compress -Depth 4
  $encrypted = ConvertTo-SecureString $json -AsPlainText -Force | ConvertFrom-SecureString
  $stream = [IO.File]::Open($store, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try { $writer = New-Object IO.StreamWriter($stream); try { $writer.Write($encrypted) } finally { $writer.Dispose() } }
  finally { $stream.Dispose() }
} else { $accounts = Read-QaAccounts }

try {
  $env:BLUETAP_QA_ACCOUNT_DATA = $accounts | ConvertTo-Json -Compress -Depth 4
  $operation = if ($Action -eq 'RepairProfile') { 'repair-profile' } else { 'apply' }
  & node $helper $operation
  if ($LASTEXITCODE -ne 0) { throw 'Applying the local fixture failed. The encrypted store was retained for a safe retry.' }
} finally { [Environment]::SetEnvironmentVariable('BLUETAP_QA_ACCOUNT_DATA', $null, 'Process') }
