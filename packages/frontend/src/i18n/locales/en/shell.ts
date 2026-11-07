import type { Namespace } from '../../types';

export const shell: Namespace<'shell'> = {
  mainNavigation: 'Main navigation',
  overview: 'Overview',
  newServer: 'New server',
  system: 'System',
  servers: 'Servers',
  loadingServers: 'Loading …',
  noServers: 'No servers yet',
  logout: 'Log out',
  connecting: 'Connecting to the server …',
  connectionLost: 'Connection to the server lost. The data shown may be out of date; reconnecting automatically.',
  starting: 'Starting MCraftManager …',
  noConnection: 'No connection to MCraftManager',
  rootMissing: 'The #root element is missing.',
  notFoundTitle: 'Page not found',
  notFoundText: 'This address does not belong to any page of MCraftManager.',
  toOverview: 'Back to overview',
  languageLabel: 'Sprache / Language',
  languageTitle: 'Sprache / Language',
  languageDescription: 'Language of the interface. This setting applies to this browser only.',
  languageNote: 'Note: some messages from the server may still appear in German.',
};
