@echo off
rem LocalMC CraftManager ohne Installation und ohne Dienst starten (Windows, ZIP-Paket).
rem Daten, Server und Konfiguration liegen im Ordner "daten" neben diesem Skript.
rem Beenden mit Strg+C: Minecraft-Server werden dabei sauber gestoppt.
setlocal
cd /d "%~dp0"
set "DATAROOT=%~dp0daten"
if not exist "%DATAROOT%\craftmanager.env" (
  "%~dp0node\node.exe" "%~dp0tools\setup-config.mjs" --config "%DATAROOT%\craftmanager.env" --data-dir "%DATAROOT%\data" --servers-dir "%DATAROOT%\servers" --host 127.0.0.1 --credentials-file "%DATAROOT%\Zugangsdaten.txt"
  if errorlevel 1 exit /b 1
  echo.
  echo Das Zugriffstoken steht in "%DATAROOT%\Zugangsdaten.txt".
  echo.
)
set "CONFIG_FILE=%DATAROOT%\craftmanager.env"
set "NODE_ENV=production"
echo Weboberflaeche: http://localhost:3000  (Port und Adresse in %CONFIG_FILE%)
"%~dp0node\node.exe" "%~dp0app\backend\dist\index.js"
