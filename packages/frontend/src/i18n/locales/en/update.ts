import type { Namespace } from '../../types';

// Must mirror locales/de/update.ts exactly (a missing or extra key is a type error).
export const update: Namespace<'update'> = {
  details: 'Details',
  unknownReason: 'Unknown reason.',
  versionName: (version) => `Version ${version}`,
  availability: (prerelease, installed) => `is available${prerelease ? ' (pre-release)' : ''}. Installed: ${installed}.`,
  updatedTo: (version) => `LanQuarry has been updated to version ${version}.`,
  failedWith: (reason) => `The update failed: ${reason}`,
  downloadPage: 'Go to the download page',
  releaseNotes: 'Release notes',
  noReleaseNotes: 'No release notes available.',
  applyNow: 'Update now',
  applyTitle: (version) => `Update to version ${version} now?`,
  stopAllTitle: 'All running Minecraft servers will be stopped',
  noServerRunning: 'Currently no server is running.',
  serversRunning: (count, countText) => (count === 1 ? `Currently ${countText} is running.` : `Currently ${countText} are running.`),
  serverSingular: 'server',
  serverPlural: 'servers',
  applyConsequence:
    'Players receive chat warnings with a countdown, then the servers are stopped cleanly (the world is saved) and started again automatically after the update. LanQuarry is briefly unreachable while the update is installed.',
  countdownLabel: 'Countdown for the players (seconds)',
  countdownHint: (max) => `0 stops the servers immediately. At most ${max} seconds.`,
  cancelUpdate: 'Cancel update',
  downloadLabel: 'Download of the update',
  phases: {
    idle: 'Ready',
    downloading: 'Downloading the update',
    verifying: 'Checking signature and checksum',
    'waiting-for-servers': 'Warning and stopping the servers',
    installing: 'Installing the update',
    restarting: 'LanQuarry is restarting',
    done: 'Update complete',
    failed: 'Update failed',
  },
  results: {
    success: 'Successful',
    failed: 'Failed',
    rolled_back: 'Rolled back',
    cancelled: 'Cancelled',
  },
};
