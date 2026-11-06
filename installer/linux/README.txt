LocalMC CraftManager (Linux, systemd)

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.

Install or update (as root, in the extracted folder):

  sudo ./install.sh                  # port 3000, firewall unchanged
  sudo ./install.sh --open-firewall  # additionally ufw/firewalld: TCP 3000 and 25565-25575
  sudo ./install.sh --port 8080      # different web port on first installation

The script creates the system user "craftmanager", installs to /opt/craftmanager, stores data in
/var/lib/craftmanager and the configuration in /etc/craftmanager/craftmanager.env (mode 640, root:craftmanager),
sets up the systemd service "craftmanager", starts it and finally shows the address and the access token.

  Status:        systemctl status craftmanager
  Log:           journalctl -u craftmanager -f
  Restart:       sudo systemctl restart craftmanager
  Show token:    sudo grep AUTH_TOKEN /etc/craftmanager/craftmanager.env

Addresses: During installation and at startup (journalctl -u craftmanager) the addresses on the home network are
listed, e.g. http://192.168.178.20:3000. Port, address and further computer names can be changed in the web interface
under "System > Network & access". Firewall: open the web port and the Minecraft ports (--open-firewall).

Password: The access token is the first password; you can set your own under "System". If you forget it:

  sudo craftmanager reset-password

Update: extract the new archive and run "sudo ./install.sh" again. Data and configuration are kept.

Uninstall:

  sudo /opt/craftmanager/uninstall.sh            # keeps data and configuration
  sudo /opt/craftmanager/uninstall.sh --purge    # also deletes all servers, worlds and backups

Java does not have to be installed: CraftManager downloads the matching version (Eclipse Temurin) itself into
/var/lib/craftmanager/runtimes.

More information: see README.md in the project (section "Installation") and the docs folder (INSTALL.md).
Licenses of the bundled components: THIRD-PARTY-NOTICES.txt
