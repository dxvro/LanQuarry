// Fest eingetragene Fremdkomponenten. Änderungen hier sind bewusste Entscheidungen.

// WinSW (MIT): macht aus node.exe einen Windows-Dienst. Version 2.12.0 ist die letzte stabile Version
// (3.x ist nur als Alpha veröffentlicht). Das Projekt veröffentlicht keine Prüfsummen; die SHA-256
// wurde beim Eintragen aus dem GitHub-Release v2.12.0 berechnet und gilt ab dann als Festlegung.
export const WINSW = {
  version: '2.12.0',
  url: 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe',
  fileName: 'WinSW-x64-v2.12.0.exe',
  sha256: '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da',
  // github.com leitet auf release-assets.githubusercontent.com weiter
  allowedHosts: ['github.com', 'githubusercontent.com'],
  license: 'MIT',
};

export const NODE_ALLOWED_HOSTS = ['nodejs.org'];

export const NPM_REGISTRY_HOSTS = ['registry.npmjs.org'];
