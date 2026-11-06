@echo off
rem LocalMC CraftManager: Passwort der Weboberflaeche zuruecksetzen (nur lokal, nur als Administrator).
rem Zeigt ein neues zufaelliges Passwort an und meldet alle bestehenden Anmeldungen ab. Der Dienst muss dafuer
rem nicht gestoppt werden. Das Zugriffstoken (AUTH_TOKEN) fuer Skripte bleibt unveraendert.
rem Installation: Startmenue "Passwort zuruecksetzen". Portabel (ZIP): Datei im Paketordner ausfuehren.
setlocal
cd /d "%~dp0"
if exist "%~dp0daten\craftmanager.env" (
  rem portable Variante: Daten liegen neben dem Skript, keine erhoehten Rechte noetig
  set "CONFIG_FILE=%~dp0daten\craftmanager.env"
  goto run
)
set "CONFIG_FILE=%ProgramData%\LocalMC CraftManager\craftmanager.env"
net session >nul 2>&1
if errorlevel 1 (
  echo Administratorrechte werden angefordert ...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
:run
set "NODE_ENV=production"
"%~dp0node\node.exe" "%~dp0app\backend\dist\cli.js" reset-password %*
echo.
pause
