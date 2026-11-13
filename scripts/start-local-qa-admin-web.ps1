param(
  [ValidateSet(8081, 8082)]
  [int]$Port = 8082
)

$ErrorActionPreference = 'Stop'
$qaRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
# An ordinary Expo listener on the other localhost address can serve a
# different bundle on the same port. Refuse to start until the port is clear.
try {
  $qaListeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -eq $Port })
} catch {
  throw 'Cannot verify local-QA web port ownership; refusing to start.'
}
if ($qaListeners.Count -ne 0) {
  throw "Port $Port already has a listener. Stop the existing local web server before starting local QA."
}
# Keep Metro's cleared transform cache separate from any existing development server.
$qaTemp = Join-Path ([IO.Path]::GetTempPath()) ("bluetap-admin-web-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $qaTemp | Out-Null
$env:TEMP = $qaTemp
$env:TMP = $qaTemp
$env:EXPO_NO_DOTENV = '1'
$env:APP_ENV = 'local-qa'
$env:EXPO_PUBLIC_APP_ENV = 'local-qa'
$env:EXPO_PUBLIC_LOCAL_QA = '1'
$env:EXPO_PUBLIC_FIREBASE_PROJECT_ID = 'demo-bluetap-local-qa'
$env:EXPO_PUBLIC_FIREBASE_API_KEY = 'fake-local-qa-key'
$env:EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN = 'demo-bluetap-local-qa.firebaseapp.com'
$env:EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = '111111111111'
$env:EXPO_PUBLIC_FIREBASE_APP_ID = '1:111111111111:web:localqa'
$env:EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET = 'demo-bluetap-local-qa.appspot.com'
$env:EXPO_PUBLIC_API_BASE_URL = 'http://127.0.0.1:3000'
$env:EXPO_PUBLIC_AUTH_EMULATOR_URL = 'http://127.0.0.1:9099'
$env:EXPO_PUBLIC_FIRESTORE_EMULATOR_HOST = '127.0.0.1'
$env:EXPO_PUBLIC_FIRESTORE_EMULATOR_PORT = '8080'
$env:BLUETAP_QA_WEB_PORT = [string]$Port
$qaLoopbackGuard = (Join-Path $qaRoot 'scripts/local-qa-loopback.js').Replace('\', '/')
$env:NODE_OPTIONS = "--require=`"$qaLoopbackGuard`""
Push-Location $qaRoot
try {
  & npx expo start --web --localhost --port $Port --clear
  if ($LASTEXITCODE -ne 0) { throw 'Local-QA web startup failed.' }
} finally { Pop-Location }
