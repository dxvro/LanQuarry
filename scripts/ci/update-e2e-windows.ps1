# Echter Installations- und Update-Test des Windows-Installers (windows-latest, Administrator).
#
# Ablauf: Test-Installer 0.x.y still installieren, Dienste und Rechte prüfen, über die Weboberflächen-API auf eine
# höhere Version aktualisieren (Update-Dienst -> Aufgabenplanung -> still ausgeführtes Setup), danach deinstallieren.
#
# Die Test-Pakete tragen eine Markierung (tools\update-test.json), die nur in dieser CI gebaut wird. Sie erlaubt die
# lokale Update-Quelle und den Wegwerf-Schlüssel; Pakete aus release.yml haben beides nicht.
#
# Nicht prüfbar auf dem Runner: SmartScreen, die Benutzerkontensteuerung (der Runner ist bereits Administrator),
# Windows Server 2016 und ein Neustart des Rechners mit laufendem Dienst.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $root
$work = Join-Path $env:RUNNER_TEMP 'cm-update-e2e'
Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $work | Out-Null
$apiPort = 4599
$api = "http://127.0.0.1:$apiPort"
$dataDir = Join-Path $env:ProgramData 'LocalMC CraftManager'
$updateDir = Join-Path $env:ProgramData 'LocalMC CraftManager Update'
$installDir = Join-Path $env:ProgramFiles 'LocalMC CraftManager'
$fake = $null

function Step($text) { Write-Host "`n=== $text" }
function Fail($text) { throw $text }

function Dump {
  Write-Host "`n--- Diagnose ---"
  foreach ($f in @((Join-Path $updateDir 'status.json'), (Join-Path $updateDir 'updater.log'))) {
    if (Test-Path $f) { Write-Host "[$f]"; Get-Content $f -Tail 60 }
  }
  Get-ChildItem $work -Filter '*.log' -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "[$($_.Name)]"; Get-Content $_.FullName -Tail 40 }
  Get-ChildItem $updateDir -Filter 'setup-*.log' -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "[$($_.Name)]"; Get-Content $_.FullName -Tail 60 }
  Get-ChildItem (Join-Path $dataDir 'logs') -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "[$($_.Name)]"; Get-Content $_.FullName -Tail 30 }
  Get-Service craftmanager, craftmanager-updater -ErrorAction SilentlyContinue | Format-Table -AutoSize | Out-String | Write-Host
}

function Wait-Until($what, $seconds, [scriptblock]$check) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    try { if (& $check) { return } } catch { }
    Start-Sleep -Seconds 2
  }
  Fail "Zeitüberschreitung: $what"
}

function Read-Config($name) {
  $line = Get-Content (Join-Path $dataDir 'craftmanager.env') | Where-Object { $_ -match "^$name=" } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -replace "^$name=", '').Trim("'")
}

function Api($method, $path, $body = $null) {
  $headers = @{ Authorization = "Bearer $script:token" }
  $uri = "http://127.0.0.1:$script:port$path"
  if ($method -eq 'GET') {
    return Invoke-RestMethod -Method $method -Uri $uri -Headers $headers
  }
  # Invoke-RestMethod would otherwise send a bodiless POST as application/x-www-form-urlencoded
  $json = if ($null -ne $body) { $body | ConvertTo-Json -Compress } else { '{}' }
  return Invoke-RestMethod -Method $method -Uri $uri -Headers $headers -ContentType 'application/json' -Body $json
}

function Health-Version { (Api 'GET' '/api/health').version }

try {
  $version = node -p "require('./packages/backend/package.json').version"
  $parts = $version.Split('.')
  $next = "$($parts[0]).$($parts[1]).$([int]$parts[2] + 1)"

  Step "Wegwerf-Schlüssel und Test-Installer bauen ($version, $next)"
  $key = Join-Path $work 'ci-private.pem'
  $pub = Join-Path $work 'ci-public.pem'
  node scripts/update-keygen.mjs --out $key --pub-out $pub | Out-Null
  $iscc = Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'
  if (-not (Test-Path $iscc)) { choco install innosetup --yes --no-progress | Out-Null }
  if (-not (Test-Path $iscc)) { Fail 'ISCC.exe wurde nicht gefunden.' }

  foreach ($entry in @(@($version, 'a'), @($next, 'b'))) {
    $v = $entry[0]; $id = $entry[1]
    node scripts/package.mjs --target win-x64 --skip-build --skip-smoke --no-archive --out (Join-Path $work "pkg-$id") --version-override $v --test-update-api $api --test-update-key $pub | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "Paket $v konnte nicht gebaut werden." }
    & $iscc "/DAppVersion=$v" "/DSourceDir=$(Join-Path $work "pkg-$id\win-x64")" "/DOutputDir=$(Join-Path $work "setup-$id")" installer\windows\craftmanager.iss | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "ISCC ist für $v mit Code $LASTEXITCODE fehlgeschlagen." }
  }
  $setupA = Join-Path $work "setup-a\craftmanager-$version-setup.exe"
  $setupB = Join-Path $work "setup-b\craftmanager-$next-setup.exe"

  Step 'Falsches GitHub mit signiertem Release starten'
  $gh = Join-Path $work 'gh'
  New-Item -ItemType Directory -Force (Join-Path $gh "v$next") | Out-Null
  Copy-Item $setupB (Join-Path $gh "v$next")
  node scripts/ci/release-fixture.mjs --dir (Join-Path $gh "v$next") --key $key --pub $pub
  if ($LASTEXITCODE -ne 0) { Fail 'Release-Dateien konnten nicht signiert werden.' }
  $fake = Start-Process node -ArgumentList @('scripts/ci/fake-github.mjs', '--dir', $gh, '--port', "$apiPort", '--repo', 'ci/test') -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $work 'fake-github.log') -RedirectStandardError (Join-Path $work 'fake-github.err.log')

  Step "Stille Installation von $version"
  $p = Start-Process $setupA -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=$(Join-Path $work 'setup-a.log')") -Wait -PassThru
  if ($p.ExitCode -ne 0) { Fail "Setup endete mit Code $($p.ExitCode)." }
  foreach ($name in 'craftmanager', 'craftmanager-updater') {
    $svc = Get-Service $name
    if ($svc.Status -ne 'Running') { Fail "Dienst $name läuft nicht ($($svc.Status))." }
  }
  if (-not (Test-Path (Join-Path $dataDir 'Zugangsdaten.txt'))) { Fail 'Zugangsdaten.txt fehlt.' }
  $script:token = Read-Config 'AUTH_TOKEN'
  $script:port = [int](Read-Config 'PORT')
  if (-not $script:token) { Fail 'Kein Token in der Konfiguration.' }
  Wait-Until "Start von $version" 90 { (Health-Version) -eq $version }
  # ohne Token gibt es keine Daten
  try { Invoke-RestMethod "http://127.0.0.1:$script:port/api/servers" | Out-Null; Fail 'API ohne Token erreichbar.' } catch { if ($_.Exception.Message -eq 'API ohne Token erreichbar.') { throw } }

  Step 'Konten und Rechte'
  $sc = (sc.exe qc craftmanager | Out-String)
  if ($sc -notmatch 'NT SERVICE\\craftmanager') { Fail "Dienstkonto falsch:`n$sc" }
  $scu = (sc.exe qc craftmanager-updater | Out-String)
  if ($scu -notmatch 'LocalSystem') { Fail "Update-Dienst läuft nicht als LocalSystem:`n$scu" }
  $acl = (icacls $updateDir | Out-String)
  if ($acl -notmatch 'NT SERVICE\\craftmanager:\(OI\)\(CI\)\(RX\)') { Fail "Update-Ordner: Dienstkonto sollte nur lesen dürfen:`n$acl" }
  $aclRequest = (icacls (Join-Path $updateDir 'request') | Out-String)
  if ($aclRequest -notmatch 'NT SERVICE\\craftmanager:\(OI\)\(CI\)\(M\)') { Fail "request: Dienstkonto sollte schreiben dürfen:`n$aclRequest" }
  $aclWork = (icacls (Join-Path $updateDir 'work') | Out-String)
  if ($aclWork -match 'NT SERVICE\\craftmanager') { Fail "work: Dienstkonto darf keinen Zugriff haben:`n$aclWork" }
  $aclInstall = (icacls $installDir | Out-String)
  if ($aclInstall -match 'NT SERVICE\\craftmanager:.*\((F|M|W)\)') { Fail "Programmordner: Dienstkonto darf nichts ändern:`n$aclInstall" }

  Step 'Anwendung auf das falsche GitHub zeigen lassen'
  Add-Content -Path (Join-Path $dataDir 'craftmanager.env') -Value "UPDATE_REPO='ci/test'`nUPDATE_API_BASE='$api'"
  Restart-Service craftmanager
  Wait-Until 'Neustart des Dienstes' 90 { (Health-Version) -eq $version }
  $state = Api 'GET' '/api/system/update'
  if ($state.installMode -ne 'service') { Fail "Installationsart ist $($state.installMode), erwartet service." }

  Step "Update auf $next"
  $checked = Api 'POST' '/api/system/update/check'
  if (-not $checked.updateAvailable -or $checked.latest.version -ne $next) { Fail "Update nicht erkannt: $($checked | ConvertTo-Json -Depth 5)" }
  if (-not $checked.canApply) { Fail "Update nicht ausführbar: $($checked.canApplyReason)" }
  Api 'POST' '/api/system/update/apply' @{ confirm = $true; countdownSeconds = 0 } | Out-Null
  Wait-Until "neue Version $next" 600 { (Health-Version) -eq $next }
  Wait-Until 'Eintrag im Update-Verlauf' 120 { (Api 'GET' '/api/system/update').history[0].result -eq 'success' }
  foreach ($name in 'craftmanager', 'craftmanager-updater') {
    if ((Get-Service $name).Status -ne 'Running') { Fail "Dienst $name läuft nach dem Update nicht." }
  }
  if ((Get-Content (Join-Path $installDir 'VERSION') -Raw).Trim() -ne $next) { Fail 'VERSION im Programmordner stimmt nicht.' }
  if ((Read-Config 'AUTH_TOKEN') -ne $script:token) { Fail 'Das Token hat sich beim Update geändert.' }
  Write-Host 'Update auf Windows erfolgreich.'

  Step 'Deinstallation behält die Daten'
  $uninstaller = Get-ChildItem $installDir -Filter 'unins*.exe' | Select-Object -First 1
  $u = Start-Process $uninstaller.FullName -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART') -Wait -PassThru
  if ($u.ExitCode -ne 0) { Fail "Deinstallation endete mit Code $($u.ExitCode)." }
  # the uninstaller finishes in a second process and deletes services and folders a moment after it returns
  Wait-Until 'Dienst craftmanager entfernt' 60 { -not (Get-Service craftmanager -ErrorAction SilentlyContinue) }
  Wait-Until 'Dienst craftmanager-updater entfernt' 60 { -not (Get-Service craftmanager-updater -ErrorAction SilentlyContinue) }
  Wait-Until 'Programmdateien entfernt' 60 { -not (Test-Path (Join-Path $installDir 'node')) }
  Wait-Until 'Update-Ordner entfernt' 60 { -not (Test-Path $updateDir) }
  if (-not (Test-Path (Join-Path $dataDir 'craftmanager.env'))) { Fail 'Die Konfiguration wurde gelöscht.' }
  Write-Host 'Windows-Installer-Test bestanden.'
}
catch {
  Write-Host "FEHLER: $($_.Exception.Message)"
  Dump
  throw
}
finally {
  if ($fake -and -not $fake.HasExited) { Stop-Process -Id $fake.Id -Force -ErrorAction SilentlyContinue }
}
