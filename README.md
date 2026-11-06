# LocalMC CraftManager

> **NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.**

## What is it?

CraftManager manages several Minecraft servers on one computer and is operated conveniently in the browser on your local network (LAN), from a PC, tablet or phone. Creating, starting, monitoring and backing up servers works without a command line.

- **Several servers** side by side: Vanilla, Fabric, Paper, NeoForge and Forge
- **Live console** with command input and history
- **Mods and plugins** from Modrinth: install, enable and disable, and update
- **Players:** whitelist, operators (OPs) and ban lists
- **World settings:** all values of `server.properties` in an editor
- **World backups** by hand or on a schedule, with restore
- **Import and export worlds**, with or without mods
- **Automatic Java installation:** if the matching Java version is missing, CraftManager downloads it itself (Eclipse Temurin)
- **Autostart** of individual servers when CraftManager starts
- **German and English** in the interface (switchable; the German labels quoted below, such as "System > Passwort", are what you see in the German interface)
- **Update notice** for new versions; nothing is installed until an administrator confirms

## How does it work?

CraftManager runs as a service (Windows service, or systemd on Linux) on a computer or in a VM and starts with the system. From any device on your home network you open `http://<IP address>:3000` in the browser and sign in with the password. Servers, worlds and data stay on that computer. Each Minecraft server gets its own port (default 25565) that players connect to.

> **Security notice:** The web interface can start programs and is unencrypted (HTTP). Run it only on a home network or other trusted networks, and never expose the web port (3000) to the internet.

## Installation

All packages are on the **Releases** page: <https://github.com/dxvro/LocalMC-CraftManager/releases>

Neither Git, Node.js nor Java has to be installed on the target computer.

**System requirements:** Windows 10/11 or Windows Server 2016 and newer (x64), or Linux with systemd, glibc 2.28 or newer, and x86_64 or arm64. Internet access is needed for Java, Minecraft and mod downloads.

### Windows

1. Download `craftmanager-<version>-setup.exe` and `SHA256SUMS.txt` from the Releases page.
2. Double-click the file. It is **not signed**, so Windows SmartScreen shows the message "Windows protected your PC" (German: "Der Computer wurde durch Windows geschützt"). Click **More info** and then **Run anyway**. If you want to be sure, compare the checksum first: `Get-FileHash .\craftmanager-<version>-setup.exe` (compare the value with `SHA256SUMS.txt`). The administrator confirmation (UAC) is needed because a service is set up.
3. Choose the installer language (English or German) and then the optional tasks: **Windows Firewall** (rules for private networks only: web port 3000 and Minecraft ports 25565-25575; without them other devices cannot reach the computer) and **Start menu shortcut**.
4. The installer copies the program files to `C:\Program Files\LocalMC CraftManager`, sets up the Windows service `craftmanager` (starts with Windows) and starts it.
5. **First sign-in:** At the end, the installer shows the address (`http://<computer name>:3000`) and the **access token**. Both are also in `C:\ProgramData\LocalMC CraftManager\credentials.txt` (only administrators can read it; you may delete it after noting them down). Open the address in the browser and sign in with the token. It is also the first password; you can set your own in the interface under **System > Passwort** (System > Password).
6. Forgot the password? Start menu, **Reset Password** (German installer: "Passwort zurücksetzen"; asks for administrator rights).

Program data, servers and backups are in `C:\ProgramData\LocalMC CraftManager`.

### Linux (systemd)

1. From the Releases page, download `craftmanager-<version>-linux-x64.tar.gz` (Intel/AMD) or `craftmanager-<version>-linux-arm64.tar.gz` (ARM 64 bit, e.g. Raspberry Pi 4/5 with a 64-bit system), plus `SHA256SUMS.txt`, into the same folder.
2. Check the checksum:

   ```
   sha256sum -c SHA256SUMS.txt --ignore-missing
   ```

3. Extract and install (with `root` rights):

   ```
   tar -xzf craftmanager-<version>-linux-x64.tar.gz
   cd craftmanager-<version>-linux-x64
   sudo ./install.sh
   ```

   Options: `--open-firewall` (with an active ufw or firewalld, opens TCP 3000 and 25565-25575) and `--port 8080` (a different web port on first installation).
4. `install.sh` creates the system user `craftmanager`, installs to `/opt/craftmanager`, creates `/etc/craftmanager/craftmanager.env` with a random access token, sets up the service `craftmanager` and starts it. Data and servers are in `/var/lib/craftmanager`.
5. **First sign-in:** At the end, `install.sh` prints the addresses on the home network and the **access token**. Open the address in the browser and sign in with the token; it is also the first password (set your own under **System > Passwort**). You can show the token later with:

   ```
   sudo grep AUTH_TOKEN /etc/craftmanager/craftmanager.env
   ```

6. Forgot the password? `sudo craftmanager reset-password` creates a new one.

A detailed guide with all supported Linux distributions, firewall, troubleshooting and configuration: [docs/INSTALL.md](docs/INSTALL.md)

### Updating and uninstalling

- **Updating:** CraftManager reports new versions in the interface; an administrator confirms the update. Alternatively, run the new `setup.exe` (Windows), or `sudo ./install.sh` again from the new archive (Linux), over the existing installation. Servers, data and configuration are kept.
- **Uninstalling (Windows):** Settings > Apps > LocalMC CraftManager > Uninstall. The data folder `C:\ProgramData\LocalMC CraftManager` is kept.
- **Uninstalling (Linux):** `sudo /opt/craftmanager/uninstall.sh` (keeps `/var/lib/craftmanager` and `/etc/craftmanager`; with `--purge` everything is deleted).

## Documentation

- [docs/INSTALL.md](docs/INSTALL.md): step-by-step installation on Windows and Linux, firewall, troubleshooting
- [docs/USAGE.md](docs/USAGE.md): the web interface, creating and starting servers, loaders, Java
- [docs/CONFIGURATION.md](docs/CONFIGURATION.md): environment variables, network access, password, security
- [docs/UPDATES.md](docs/UPDATES.md): self-update, signatures and publishing releases
- [docs/API.md](docs/API.md): HTTP API, backups, world import and export, WebSockets
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): running from source, tests and building the packages
