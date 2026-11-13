param([switch]$ReusableAccounts)

$ErrorActionPreference = 'Stop'
$qaRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

if ($ReusableAccounts) {
  . (Join-Path $PSScriptRoot 'local-qa-accounts.ps1') -Action Load
} else {
  [Environment]::SetEnvironmentVariable('BLUETAP_QA_REUSABLE_ACCOUNTS', $null, 'Process')
}

foreach ($role in @('ADMIN', 'REQUESTER')) {
  $emailName = "BLUETAP_QA_${role}_EMAIL"
  $passwordName = "BLUETAP_QA_${role}_PASSWORD"
  if (-not [Environment]::GetEnvironmentVariable($emailName, 'Process')) {
    [Environment]::SetEnvironmentVariable($emailName, (Read-Host "Disposable $role email ending in @example.test"), 'Process')
  }
  if (-not [Environment]::GetEnvironmentVariable($passwordName, 'Process')) {
    $qaSecure = Read-Host "Disposable $role password (12 or more characters)" -AsSecureString
    $qaPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($qaSecure)
    try { [Environment]::SetEnvironmentVariable($passwordName, [Runtime.InteropServices.Marshal]::PtrToStringBSTR($qaPointer), 'Process') }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($qaPointer) }
  }
}

$env:APP_ENV = 'local-qa'
$env:LOCAL_QA_EMULATORS = '1'
$env:GCLOUD_PROJECT = 'demo-bluetap-local-qa'
$env:FIREBASE_PROJECT_ID = 'demo-bluetap-local-qa'
$env:FIREBASE_WEB_API_KEY = 'fake-local-qa-key'
$env:EMAIL_OTP_HASH_SECRET = 'synthetic-local-qa-only'
$env:EXPO_PUBLIC_APP_ENV = 'local-qa'
$env:EXPO_PUBLIC_FIREBASE_PROJECT_ID = 'demo-bluetap-local-qa'
$env:EXPO_PUBLIC_API_BASE_URL = 'http://127.0.0.1:3000'
$env:ALLOWED_ORIGINS = 'http://localhost:8081,http://127.0.0.1:8081,http://localhost:8082,http://127.0.0.1:8082'
$env:BLUETAP_DRAFT_QA = '1'
$env:DEBUG = ''

# Keep emulator-generated logs and config away from the user's workspace.
$qaDirectory = Join-Path ([IO.Path]::GetTempPath()) ("bluetap-admin-drafts-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $qaDirectory | Out-Null
# Use an empty CLI configuration, never the user's Firebase login credentials.
$env:XDG_CONFIG_HOME = Join-Path $qaDirectory 'config'
New-Item -ItemType Directory -Path $env:XDG_CONFIG_HOME | Out-Null
Copy-Item -LiteralPath (Join-Path $qaRoot 'firestore.rules') -Destination (Join-Path $qaDirectory 'firestore.rules')
$qaConfig = @{ firestore = @{ rules = 'firestore.rules' }; emulators = @{ firestore = @{ host = '127.0.0.1'; port = 8080 }; auth = @{ host = '127.0.0.1'; port = 9099 }; ui = @{ enabled = $false } } }
$qaConfig | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $qaDirectory 'firebase.json') -Encoding UTF8
$qaScript = Join-Path $qaRoot 'scripts/local-qa-admin-drafts.js'
if ($ReusableAccounts) {
  $env:BLUETAP_QA_PASSWORD_MAIL = '1'
  $qaScript = Join-Path $qaRoot 'scripts/local-qa-password-controller.js'
}
Push-Location $qaDirectory
try {
  & firebase emulators:exec --project demo-bluetap-local-qa '--only=firestore,auth' --config firebase.json "node `"$qaScript`""
  if ($LASTEXITCODE -ne 0) { throw 'Local-QA emulator startup failed. Check the message above; no hosted fallback is permitted.' }
} finally { Pop-Location }
