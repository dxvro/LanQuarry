; LocalMC CraftManager - Windows-Installer (Inno Setup 6.3 oder neuer)
;
; Bauen (nach "npm run package -- --target win-x64"):
;   ISCC.exe /DAppVersion=0.1.0 installer\windows\craftmanager.iss
; Optionale Parameter: /DSourceDir=<Paketordner> /DOutputDir=<Ausgabeordner>
;
; Programm:      %ProgramFiles%\LocalMC CraftManager   (Dienst-Wrapper WinSW + Node + Anwendung)
; Daten/Config:  %ProgramData%\LocalMC CraftManager    (craftmanager.env, data\, servers\, logs\, tmp\)
; Dienst:        "craftmanager", Konto NT SERVICE\craftmanager (virtuelles Dienstkonto, kein SYSTEM)
; Update-Dienst:  "craftmanager-updater" (LocalSystem), Ordner %ProgramData%\LocalMC CraftManager Update (Anfragen, Status)
;
; Stille Aktualisierung (wie sie der Update-Dienst ausfuehrt):
;   craftmanager-<Version>-setup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /TASKS="firewall,startmenu"
; Konfiguration, Token, Daten und Server bleiben unberuehrt; die Aufgaben "firewall"/"startmenu" werden nur
; dann gesetzt, wenn sie mit /TASKS genannt werden.
;
; Die Datei ist UTF-8 mit BOM gespeichert (deutsche Umlaute).

#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\release\win-x64"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\release"
#endif

#define AppName "LocalMC CraftManager"
#define DataFolderName "LocalMC CraftManager"
#define ServiceId "craftmanager"
#define ServiceExe "craftmanager-service.exe"
#define ServiceAccount "NT SERVICE\craftmanager"
#define UpdaterId "craftmanager-updater"
#define UpdaterExe "craftmanager-updater-service.exe"
#define UpdateFolderName "LocalMC CraftManager Update"
#define UpdateTaskName "CraftManagerUpdate"
#define FirewallWebRule "LocalMC CraftManager - Web"
#define FirewallMcRule "LocalMC CraftManager - Minecraft"
#define McPortRange "25565-25575"

[Setup]
AppId={{6F1D2B7C-93A4-4E58-B0C6-5A2E8D41F7A3}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=LocalMC CraftManager
DefaultDirName={autopf}\{#AppName}
DisableProgramGroupPage=yes
DefaultGroupName={#AppName}
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputDir}
OutputBaseFilename=craftmanager-{#AppVersion}-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
CloseApplications=no
RestartApplications=no
UninstallDisplayName={#AppName}
VersionInfoVersion={#AppVersion}
VersionInfoDescription={#AppName} Setup
DisableWelcomePage=no

[Languages]
Name: "german"; MessagesFile: "compiler:Languages\German.isl"

[Messages]
german.WelcomeLabel2=Dieser Assistent installiert [name/ver] auf Ihrem Computer.%n%nKein offizielles Minecraft-Produkt. Nicht von Mojang oder Microsoft genehmigt oder mit ihnen verbunden.%n%nEs wird empfohlen, alle anderen Anwendungen zu schließen, bevor Sie fortfahren.
german.FinishedLabel=Das Setup hat [name] auf Ihrem Computer installiert. Adressen und Zugriffstoken stehen auf der vorherigen Seite und in der Datei Zugangsdaten.txt.%n%nKein offizielles Minecraft-Produkt. Nicht von Mojang oder Microsoft genehmigt oder mit ihnen verbunden.
german.FinishedLabelNoIcons=Das Setup hat [name] auf Ihrem Computer installiert. Adressen und Zugriffstoken stehen auf der vorherigen Seite und in der Datei Zugangsdaten.txt.%n%nKein offizielles Minecraft-Produkt. Nicht von Mojang oder Microsoft genehmigt oder mit ihnen verbunden.

[Tasks]
Name: "firewall"; Description: "Windows-Firewall: Web-Port (TCP 3000 bzw. der in der Konfiguration eingestellte Port) und Minecraft-Ports (TCP {#McPortRange}) für private Netzwerke freigeben"; GroupDescription: "Netzwerk:"
Name: "startmenu"; Description: "Verknüpfung im Startmenü, die die Weboberfläche öffnet"; GroupDescription: "Verknüpfungen:"

[Dirs]
Name: "{commonappdata}\{#DataFolderName}"; Flags: uninsneveruninstall
Name: "{commonappdata}\{#DataFolderName}\logs"; Flags: uninsneveruninstall
Name: "{commonappdata}\{#DataFolderName}\tmp"; Flags: uninsneveruninstall

[Files]
; start-portable.cmd und LIESMICH.txt gehören nur zum ZIP-Paket
Source: "{#SourceDir}\*"; DestDir: "{app}"; Excludes: "start-portable.cmd,LIESMICH.txt"; Flags: recursesubdirs createallsubdirs ignoreversion

[INI]
Filename: "{app}\CraftManager.url"; Section: "InternetShortcut"; Key: "URL"; String: "http://localhost:{code:WebPort}"; Tasks: startmenu

[Icons]
Name: "{group}\CraftManager Weboberfläche"; Filename: "{app}\CraftManager.url"; Tasks: startmenu
; Fordert selbst Administratorrechte an (reset-password.cmd) und zeigt ein neues Passwort an
Name: "{group}\Passwort zurücksetzen"; Filename: "{app}\reset-password.cmd"; WorkingDir: "{app}"; Comment: "Passwort der Weboberfläche zurücksetzen (nur als Administrator)"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
Type: filesandordirs; Name: "{commonappdata}\{#UpdateFolderName}"

[Code]
const
  ServiceName = '{#ServiceId}';
  UpdaterName = '{#UpdaterId}';
  ServiceAccount = '{#ServiceAccount}';
  SidSystem = '*S-1-5-18';
  SidAdministrators = '*S-1-5-32-544';
  DefaultPort = '3000';

var
  CredPage: TWizardPage;
  CredMemo: TNewMemo;
  FirstInstall: Boolean;

function DataDir: String;
begin
  Result := ExpandConstant('{commonappdata}\{#DataFolderName}');
end;

function ConfigFile: String;
begin
  Result := DataDir + '\craftmanager.env';
end;

function CredentialsFile: String;
begin
  Result := DataDir + '\Zugangsdaten.txt';
end;

function ServiceTool: String;
begin
  Result := ExpandConstant('{app}\{#ServiceExe}');
end;

function UpdaterTool: String;
begin
  Result := ExpandConstant('{app}\{#UpdaterExe}');
end;

function UpdateRoot: String;
begin
  Result := ExpandConstant('{commonappdata}\{#UpdateFolderName}');
end;

function RunTool(const FileName, Params: String): Integer;
var
  ResultCode: Integer;
begin
  ResultCode := -1;
  if not Exec(FileName, Params, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    ResultCode := -1;
  Log(Format('Exec: "%s" %s -> %d', [FileName, Params, ResultCode]));
  Result := ResultCode;
end;

{ Liest einen Wert (KEY=Wert) aus der Konfigurationsdatei; Anführungszeichen werden entfernt }
function ReadConfigValue(const Key, Fallback: String): String;
var
  Lines: TArrayOfString;
  I: Integer;
  Line, Value: String;
begin
  Result := Fallback;
  if not LoadStringsFromFile(ConfigFile, Lines) then
    Exit;
  for I := 0 to GetArrayLength(Lines) - 1 do
  begin
    Line := Trim(Lines[I]);
    if Pos(Key + '=', Line) = 1 then
    begin
      Value := Trim(Copy(Line, Length(Key) + 2, MaxInt));
      if (Length(Value) >= 2) and (Value[1] = '''') and (Value[Length(Value)] = '''') then
        Value := Copy(Value, 2, Length(Value) - 2);
      if Value <> '' then
        Result := Value;
      Exit;
    end;
  end;
end;

{ Web-Port: der Port, auf dem die Anwendung wirklich lauscht (data\network.json; in der Weboberfläche änderbar),
  sonst PORT aus der vorhandenen Konfiguration, sonst 3000 }
function WebPort(Param: String): String;
var
  Raw: AnsiString;
  Json, Digits: String;
  P: Integer;
begin
  Result := ReadConfigValue('PORT', DefaultPort);
  if LoadStringFromFile(DataDir + '\data\network.json', Raw) then
  begin
    Json := String(Raw);
    P := Pos('"port":', Json);
    if P > 0 then
    begin
      Digits := '';
      P := P + 7;
      while (P <= Length(Json)) and (Json[P] >= '0') and (Json[P] <= '9') do
      begin
        Digits := Digits + Json[P];
        P := P + 1;
      end;
      if Digits <> '' then
        Result := Digits;
    end;
  end;
end;

{ Adressen im Heimnetz: tools\lan.mjs mit der mitgelieferten Node-Programmdatei (gleiche Auswahl wie die Anwendung:
  private Adressen zuerst, keine Link-Local-Adressen, virtuelle Adapter getrennt); der Port kommt aus network.json }
function LanAddressText(const Fallback: String): String;
var
  Params, OutFile: String;
  Raw: AnsiString;
  ResultCode: Integer;
begin
  Result := Fallback;
  OutFile := ExpandConstant('{tmp}\lan.txt');
  DeleteFile(OutFile);
  Params := '/C ""' + ExpandConstant('{app}\node\node.exe') + '" "' + ExpandConstant('{app}\tools\lan.mjs') + '" --text --data-dir "' +
    DataDir + '\data" --config "' + ConfigFile + '" > "' + OutFile + '""';
  if Exec(ExpandConstant('{cmd}'), Params, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0) then
    if LoadStringFromFile(OutFile, Raw) and (Trim(String(Raw)) <> '') then
      Result := TrimRight(String(Raw));
end;

function ServiceInstalled: Boolean;
begin
  Result := RunTool(ExpandConstant('{sys}\sc.exe'), 'query ' + ServiceName) = 0;
end;

{ icacls mit Konten "NT SERVICE\<Dienst>": Das virtuelle Dienstkonto gibt es erst, wenn der Dienst registriert ist (vorher
  Fehler 1332, ERROR_NONE_MAPPED). Deshalb steht jeder Aufruf, der das Dienstkonto nennt, NACH RegisterService. Die
  Namensaufloesung kann unmittelbar nach der Registrierung noch einen Moment brauchen: bei 1332 wird kurz wiederholt. }
function RunIcacls(const Params: String): Integer;
var
  Attempt: Integer;
begin
  Result := -1;
  for Attempt := 1 to 5 do
  begin
    Result := RunTool(ExpandConstant('{sys}\icacls.exe'), Params);
    if Result <> 1332 then
      Exit;
    Sleep(1000);
  end;
end;

procedure StopService;
begin
  if FileExists(ServiceTool) then
    RunTool(ServiceTool, 'stopwait')
  else
    RunTool(ExpandConstant('{sys}\net.exe'), 'stop ' + ServiceName);
  { zweite Absicherung: net stop wartet, bis der Dienst wirklich gestoppt ist; 2 = war nicht gestartet }
  RunTool(ExpandConstant('{sys}\net.exe'), 'stop ' + ServiceName);
end;

{ Der Update-Dienst haelt node.exe offen und wird vom Installer ersetzt: vorher stoppen }
procedure StopUpdater;
begin
  RunTool(ExpandConstant('{sys}\net.exe'), 'stop ' + UpdaterName);
end;

procedure InitializeWizard;
begin
  CredPage := CreateCustomPage(wpInstalling, 'Zugangsdaten', 'Adresse und Zugriffstoken von LocalMC CraftManager');
  CredMemo := TNewMemo.Create(CredPage);
  CredMemo.Parent := CredPage.Surface;
  CredMemo.Left := 0;
  CredMemo.Top := 0;
  CredMemo.Width := CredPage.SurfaceWidth;
  CredMemo.Height := CredPage.SurfaceHeight;
  CredMemo.ReadOnly := True;
  CredMemo.ScrollBars := ssVertical;
  CredMemo.WordWrap := True;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  FirstInstall := not FileExists(ConfigFile);
  if ServiceInstalled then
  begin
    Log('Dienst vorhanden, wird für das Update gestoppt.');
    StopService;
  end;
  StopUpdater;
end;

{ Platzhalter @DATADIR@ und @UPDATEROOT@ in den WinSW-Konfigurationen ersetzen }
procedure FillServiceConfig(const XmlName: String);
var
  FileName: String;
  Raw: AnsiString;
  Text: String;
begin
  FileName := ExpandConstant('{app}\' + XmlName);
  if not LoadStringFromFile(FileName, Raw) then
    RaiseException('Die Dienst-Konfiguration ' + XmlName + ' fehlt.');
  Text := String(Raw);
  StringChangeEx(Text, '@DATADIR@', DataDir, True);
  StringChangeEx(Text, '@UPDATEROOT@', UpdateRoot, True);
  if not SaveStringToFile(FileName, AnsiString(Text), False) then
    RaiseException('Die Dienst-Konfiguration konnte nicht geschrieben werden.');
end;

procedure PrepareServiceConfig;
begin
  FillServiceConfig('craftmanager-service.xml');
  FillServiceConfig('craftmanager-updater-service.xml');
end;

{ Wartet, bis der Dienst aus der Dienstverwaltung verschwunden ist (sc query -> 1060). Ein Dienst, der noch "zum Löschen markiert"
  ist (1072), verschwindet erst, wenn kein Handle mehr offen ist; "install" wird deshalb zusätzlich wiederholt. }
procedure WaitForServiceGone(const Name: String);
var
  I: Integer;
begin
  for I := 1 to 30 do
  begin
    if RunTool(ExpandConstant('{sys}\sc.exe'), 'query ' + Name) = 1060 then
      Exit;
    Sleep(1000);
  end;
  Log('Der Dienst ' + Name + ' ist nach 30 Sekunden noch in der Dienstverwaltung eingetragen.');
end;

function InstallServiceWithRetry(const Tool: String): Integer;
var
  I: Integer;
begin
  Result := -1;
  for I := 1 to 30 do
  begin
    Result := RunTool(Tool, 'install');
    if Result = 0 then
      Exit;
    Sleep(1000);
  end;
end;

{ WinSW 2.x kennt kein "refresh" (erst WinSW 3). Ein vorhandener Dienst wird deshalb gestoppt, mit "uninstall" entfernt (sc delete als
  Rückfall), es wird gewartet, bis er weg ist, und dann neu mit "install" eingetragen. Die Ausfallaktionen kommen dabei
  aus der XML-Datei; das Konto setzt der Aufrufer danach mit sc config. }
function ReregisterService(const Tool, Name: String): Integer;
begin
  if RunTool(ExpandConstant('{sys}\sc.exe'), 'query ' + Name) = 0 then
  begin
    RunTool(ExpandConstant('{sys}\net.exe'), 'stop ' + Name);
    if RunTool(Tool, 'uninstall') <> 0 then
      RunTool(ExpandConstant('{sys}\sc.exe'), 'delete ' + Name);
    WaitForServiceGone(Name);
  end;
  Result := InstallServiceWithRetry(Tool);
end;

procedure RegisterService;
var
  Code: Integer;
begin
  Code := ReregisterService(ServiceTool, ServiceName);
  if Code <> 0 then
    RaiseException('Der Windows-Dienst konnte nicht eingerichtet werden (Code ' + IntToStr(Code) + '). Siehe Setup-Protokoll.');
  { virtuelles Dienstkonto statt SYSTEM: kein Kennwort, nur Zugriff auf die freigegebenen Ordner }
  Code := RunTool(ExpandConstant('{sys}\sc.exe'), 'config ' + ServiceName + ' obj= "' + ServiceAccount + '"');
  if Code <> 0 then
    RaiseException('Das Dienstkonto ' + ServiceAccount + ' konnte nicht gesetzt werden (Code ' + IntToStr(Code) + ').');
end;

{ Update-Ordner: root-eigen (SYSTEM/Administratoren), das Dienstkonto liest nur status.json und darf nur in request\ schreiben.
  work\ und backup\ sind fuer das Dienstkonto unsichtbar. Wird bei jeder Installation und jedem Update neu gesetzt. }
procedure PrepareUpdateFolders;
begin
  ForceDirectories(UpdateRoot + '\request');
  ForceDirectories(UpdateRoot + '\work');
  ForceDirectories(UpdateRoot + '\backup');
  ForceDirectories(UpdateRoot + '\logs');
  if RunIcacls('"' + UpdateRoot + '" /inheritance:r /grant:r "' + SidSystem + ':(OI)(CI)F" "' + SidAdministrators +
    ':(OI)(CI)F" "' + ServiceAccount + ':(OI)(CI)RX"') <> 0 then
    RaiseException('Die Zugriffsrechte für den Update-Ordner konnten nicht gesetzt werden. Siehe Setup-Protokoll.');
  if RunIcacls('"' + UpdateRoot + '\request" /grant:r "' + ServiceAccount + ':(OI)(CI)M"') <> 0 then
    RaiseException('Die Zugriffsrechte für den Anfrage-Ordner des Update-Dienstes konnten nicht gesetzt werden. Siehe Setup-Protokoll.');
  RunIcacls('"' + UpdateRoot + '\work" /inheritance:r /grant:r "' + SidSystem + ':(OI)(CI)F" "' + SidAdministrators + ':(OI)(CI)F"');
  RunIcacls('"' + UpdateRoot + '\backup" /inheritance:r /grant:r "' + SidSystem + ':(OI)(CI)F" "' + SidAdministrators + ':(OI)(CI)F"');
end;

procedure RegisterUpdater;
var
  Code: Integer;
begin
  { Das Setup läuft hier aus der Aufgabenplanung (Kopie von node.exe), nicht im Update-Dienst: er darf neu eingetragen werden }
  Code := ReregisterService(UpdaterTool, UpdaterName);
  if Code <> 0 then
    RaiseException('Der Update-Dienst konnte nicht eingerichtet werden (Code ' + IntToStr(Code) + '). Siehe Setup-Protokoll.');
  { LocalSystem: darf Dienste stoppen und Programmdateien ersetzen }
  RunTool(ExpandConstant('{sys}\sc.exe'), 'config ' + UpdaterName + ' obj= LocalSystem');
end;

procedure SecureFolderAndFiles;
begin
  { Datenordner: nur SYSTEM, Administratoren und das Dienstkonto (Ändern), keine Vererbung von ProgramData }
  if RunIcacls('"' + DataDir + '" /inheritance:r /grant:r "' + SidSystem + ':(OI)(CI)F" "' + SidAdministrators +
    ':(OI)(CI)F" "' + ServiceAccount + ':(OI)(CI)M"') <> 0 then
    RaiseException('Die Zugriffsrechte für den Datenordner konnten nicht gesetzt werden. Siehe Setup-Protokoll.');
end;

procedure SecureConfigFiles;
begin
  { Konfiguration (enthält das Token): Administratoren und SYSTEM voll, Dienstkonto nur lesen }
  if RunIcacls('"' + ConfigFile + '" /inheritance:r /grant:r "' + SidSystem + ':F" "' + SidAdministrators + ':F" "' +
    ServiceAccount + ':R"') <> 0 then
    RaiseException('Die Zugriffsrechte für die Konfigurationsdatei konnten nicht gesetzt werden. Siehe Setup-Protokoll.');
  { Zugangsdaten.txt: nur Administratoren und SYSTEM }
  if FileExists(CredentialsFile) then
    RunIcacls('"' + CredentialsFile + '" /inheritance:r /grant:r "' + SidSystem + ':F" "' + SidAdministrators + ':F"');
end;

procedure CreateConfig;
var
  Node, Params: String;
  Code: Integer;
begin
  Node := ExpandConstant('{app}\node\node.exe');
  Params := '"' + ExpandConstant('{app}\tools\setup-config.mjs') + '" --config "' + ConfigFile + '" --data-dir "' +
    DataDir + '\data" --servers-dir "' + DataDir + '\servers" --port ' + DefaultPort + ' --credentials-file "' +
    CredentialsFile + '"';
  Code := RunTool(Node, Params);
  if (Code <> 0) or not FileExists(ConfigFile) then
    RaiseException('Die Konfigurationsdatei konnte nicht angelegt werden (Code ' + IntToStr(Code) + ').');
end;

procedure ConfigureFirewall;
var
  Netsh, Port: String;
begin
  Netsh := ExpandConstant('{sys}\netsh.exe');
  Port := WebPort('');
  RunTool(Netsh, 'advfirewall firewall delete rule name="{#FirewallWebRule}"');
  RunTool(Netsh, 'advfirewall firewall delete rule name="{#FirewallMcRule}"');
  if RunTool(Netsh, 'advfirewall firewall add rule name="{#FirewallWebRule}" dir=in action=allow protocol=TCP localport=' +
    Port + ' profile=private') <> 0 then
    Log('Firewall-Regel für den Web-Port konnte nicht angelegt werden.');
  if RunTool(Netsh, 'advfirewall firewall add rule name="{#FirewallMcRule}" dir=in action=allow protocol=TCP localport={#McPortRange} profile=private') <> 0 then
    Log('Firewall-Regel für die Minecraft-Ports konnte nicht angelegt werden.');
end;

function WaitForHealth: Boolean;
var
  I: Integer;
  Params: String;
begin
  Result := False;
  Params := '-e "fetch(''http://127.0.0.1:' + WebPort('') + '/api/health'').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"';
  for I := 1 to 30 do
  begin
    if RunTool(ExpandConstant('{app}\node\node.exe'), Params) = 0 then
    begin
      Result := True;
      Exit;
    end;
    Sleep(1000);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    WizardForm.StatusLabel.Caption := 'Richte den Dienst ein ...';
    PrepareServiceConfig;
    { Reihenfolge: erst die Dienste registrieren (damit es NT SERVICE\craftmanager gibt), dann alle Rechte setzen, die das
      Dienstkonto nennen }
    RegisterService;
    RegisterUpdater;
    PrepareUpdateFolders;
    if FirstInstall then
      SecureFolderAndFiles;
    if FirstInstall then
      CreateConfig;
    if FirstInstall then
      SecureConfigFiles;
    if WizardIsTaskSelected('firewall') then
      ConfigureFirewall;
    WizardForm.StatusLabel.Caption := 'Starte den Dienst ...';
    if RunTool(ServiceTool, 'start') <> 0 then
      Log('Der Dienst ließ sich nicht starten.')
    else if not WaitForHealth then
      Log('Der Dienst antwortet noch nicht.');
    if RunTool(UpdaterTool, 'start') <> 0 then
      Log('Der Update-Dienst ließ sich nicht starten.');
  end;
end;

procedure CurPageChanged(CurPageID: Integer);
var
  Port, Token, Text: String;
begin
  if CurPageID <> CredPage.ID then
    Exit;
  Port := WebPort('');
  Token := ReadConfigValue('AUTH_TOKEN', '');
  Text := 'Die Weboberfläche ist erreichbar unter:' + #13#10 +
    LanAddressText('   http://' + GetComputerNameString + ':' + Port) + #13#10 +
    '   http://localhost:' + Port + '   (auf diesem Rechner)' + #13#10 +
    '(Tipp: Im Router eine feste IP-Adresse für diesen Rechner vergeben, damit sich die Adresse nicht ändert.)' + #13#10 + #13#10;
  if FirstInstall then
  begin
    Text := Text + 'Zugriffstoken zum Anmelden (bitte notieren, es ist zugleich das erste Passwort):' + #13#10 + '   ' + Token + #13#10 + #13#10 +
      'Das Token steht auch in:' + #13#10 + '   ' + ConfigFile + #13#10 + '   ' + CredentialsFile + #13#10 +
      '(beide Dateien sind nur für Administratoren lesbar)' + #13#10 + #13#10 +
      'Ein eigenes Passwort lässt sich in der Weboberfläche unter "System" festlegen. Passwort vergessen: Startmenü, "Passwort zurücksetzen".' + #13#10 + #13#10;
  end
  else
    Text := Text + 'Die vorhandene Konfiguration samt Zugriffstoken wurde beibehalten:' + #13#10 + '   ' + ConfigFile + #13#10 + #13#10;
  Text := Text + 'Daten, Server und Backups liegen unter:' + #13#10 + '   ' + DataDir + #13#10 + #13#10 +
    'Der Dienst "LocalMC CraftManager" startet mit Windows automatisch. Andere Geräte im Netzwerk erreichen ihn nur, ' +
    'wenn die Windows-Firewall den Port erlaubt (Aufgabe "Windows-Firewall" bei der Installation oder von Hand).' + #13#10 + #13#10 +
    'Kein offizielles Minecraft-Produkt. Nicht von Mojang oder Microsoft genehmigt oder mit ihnen verbunden.';
  CredMemo.Text := Text;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Tool, Netsh: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    Tool := ExpandConstant('{app}\{#ServiceExe}');
    if FileExists(Tool) then
    begin
      RunTool(Tool, 'stopwait');
      if RunTool(Tool, 'uninstall') <> 0 then
        RunTool(ExpandConstant('{sys}\sc.exe'), 'delete ' + ServiceName);
    end
    else
      RunTool(ExpandConstant('{sys}\sc.exe'), 'delete ' + ServiceName);
    { Update-Dienst und eine eventuell uebrig gebliebene einmalige Aufgabe entfernen }
    RunTool(ExpandConstant('{sys}\net.exe'), 'stop ' + UpdaterName);
    if FileExists(ExpandConstant('{app}\{#UpdaterExe}')) then
    begin
      if RunTool(ExpandConstant('{app}\{#UpdaterExe}'), 'uninstall') <> 0 then
        RunTool(ExpandConstant('{sys}\sc.exe'), 'delete ' + UpdaterName);
    end
    else
      RunTool(ExpandConstant('{sys}\sc.exe'), 'delete ' + UpdaterName);
    RunTool(ExpandConstant('{sys}\schtasks.exe'), '/Delete /TN {#UpdateTaskName} /F');
    Netsh := ExpandConstant('{sys}\netsh.exe');
    RunTool(Netsh, 'advfirewall firewall delete rule name="{#FirewallWebRule}"');
    RunTool(Netsh, 'advfirewall firewall delete rule name="{#FirewallMcRule}"');
  end;
  if CurUninstallStep = usPostUninstall then
  begin
    if not UninstallSilent then
      MsgBox('LocalMC CraftManager wurde entfernt. Dienst und Firewall-Regeln sind gelöscht.' + #13#10 + #13#10 +
        'Ihre Daten (Server, Welten, Backups, Konfiguration) wurden NICHT gelöscht und liegen weiterhin unter:' + #13#10 +
        DataDir + #13#10 + #13#10 +
        'Zum vollständigen Entfernen diesen Ordner von Hand löschen.', mbInformation, MB_OK);
  end;
end;
