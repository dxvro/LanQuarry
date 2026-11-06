export const common = {
  loading: 'Wird geladen …',
  close: 'Schließen',
  cancel: 'Abbrechen',
  retry: 'Erneut versuchen',
  unknownError: 'Unbekannter Fehler.',
  errorCode: (code: string) => `Fehlercode: ${code}`,
  // Required on every page: this is a fan-made tool for Minecraft servers, not a product of Mojang or Microsoft
  disclaimer: 'Kein offizielles Minecraft-Produkt. Nicht von Mojang oder Microsoft genehmigt oder mit ihnen verbunden.',
  // units used by lib/format.ts
  units: {
    underOneMinute: 'unter 1 Min',
    day: 'T',
    hour: 'Std',
    minute: 'Min',
    million: 'Mio.',
    thousand: 'Tsd.',
  },
  serverState: {
    offline: 'Offline',
    preparing: 'Bereitet vor',
    starting: 'Startet',
    online: 'Online',
    stopping: 'Stoppt',
    crashed: 'Abgestürzt',
  },
  installState: {
    pending: 'Wartet auf Installation',
    installing: 'Wird installiert',
    installed: 'Installiert',
    failed: 'Installation fehlgeschlagen',
  },
};
