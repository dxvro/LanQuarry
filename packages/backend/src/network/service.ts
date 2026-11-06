import { eq } from 'drizzle-orm';
import net from 'node:net';
import os from 'node:os';
import type { NetworkAddress, NetworkInput, NetworkSettings, NetworkState } from '../contract.js';
import type { Db } from '../db/client.js';
import { servers } from '../db/schema.js';
import { AppError } from '../http/errors.js';
import type { KeyedLock } from '../lib/keyed-lock.js';
import { silentLogger, type Logger } from '../lib/logger.js';
import { accessUrls, detectAddresses, isWildcardHost, localIPv4Addresses, urlFor, type DetectedAddress, type DetectedAddresses, type Interfaces } from '../lib/network.js';
import type { PortProbe } from '../process/ports.js';
import { SettingsStore } from '../settings/store.js';
import {
  effectiveNetwork,
  KEY_NETWORK,
  MAX_EXTRA_HOSTS,
  normalizeAllowedHost,
  normalizePublicAddress,
  readStoredNetwork,
  sameNetwork,
  type EffectiveNetwork,
  type NetworkDefaults,
  type StoredNetwork,
} from './settings.js';

export interface NetworkServiceOptions {
  db: Db;
  // what the process was started with (stored settings already applied)
  active: EffectiveNetwork;
  // what the config file / environment says
  defaults: NetworkDefaults;
  probePort: PortProbe;
  lock: KeyedLock;
  // service installations restart themselves, everything else has to be started by hand
  restartInfo: () => { automatic: boolean; note: string };
  interfaces?: () => Interfaces;
  hostname?: () => string;
  logger?: Logger;
}

const toDto = (entry: DetectedAddress, port: number): NetworkAddress => ({
  address: entry.address,
  interfaceName: entry.interfaceName,
  url: urlFor(entry.address, port),
  private: entry.private,
});

export class NetworkService {
  private readonly store: SettingsStore;
  private readonly logger: Logger;
  private active: EffectiveNetwork;
  private readonly warnings: string[] = [];

  constructor(private readonly options: NetworkServiceOptions) {
    this.store = new SettingsStore(options.db);
    this.logger = options.logger ?? silentLogger;
    this.active = { ...options.active, allowedHosts: [...options.active.allowedHosts] };
  }

  private interfaces(): Interfaces {
    return this.options.interfaces?.() ?? os.networkInterfaces();
  }

  get hostname(): string {
    return this.options.hostname?.() ?? os.hostname();
  }

  // the running process listens here (after a possible fallback at start)
  setActive(host: string, port: number): void {
    this.active = { ...this.active, host, port };
  }

  addWarning(text: string): void {
    this.warnings.push(text);
  }

  get activePort(): number {
    return this.active.port;
  }

  get activeHost(): string {
    return this.active.host;
  }

  detected(): DetectedAddresses {
    return detectAddresses(this.interfaces());
  }

  // Access URLs of the running process (health route)
  urls(): string[] {
    return accessUrls(this.active.host, this.active.port, this.detected());
  }

  async state(): Promise<NetworkState> {
    return this.toState(await readStoredNetwork(this.store));
  }

  private toState(stored: StoredNetwork): NetworkState {
    const detected = this.detected();
    const pending = effectiveNetwork(this.options.defaults, stored);
    const hostname = this.hostname;
    const publicUrl = stored.publicAddress === undefined ? null : (normalizePublicAddress(stored.publicAddress)?.url ?? null);
    const settings: NetworkSettings = {
      bindHost: stored.bindHost ?? null,
      port: stored.port ?? null,
      allowedHosts: stored.allowedHosts ?? [],
      publicAddress: publicUrl,
    };
    return {
      hostname,
      hostnameUrl: `http://${hostname}:${this.active.port}`,
      lan: detected.lan.map((entry) => toDto(entry, this.active.port)),
      virtual: detected.virtual.map((entry) => toDto(entry, this.active.port)),
      active: { host: this.active.host, port: this.active.port, allowedHosts: this.active.allowedHosts, urls: accessUrls(this.active.host, this.active.port, detected) },
      settings,
      defaults: { host: this.options.defaults.host, port: this.options.defaults.port, allowedHosts: this.options.defaults.allowedHosts },
      pending: { host: pending.host, port: pending.port, allowedHosts: pending.allowedHosts, urls: accessUrls(pending.host, pending.port, detected) },
      publicUrl,
      restartRequired: !sameNetwork(pending, this.active),
      warnings: [...this.warnings],
      restart: this.options.restartInfo(),
    };
  }

  // The addresses people should open after the next start (public address first, then the machine name)
  async pendingUrls(): Promise<string[]> {
    const state = await this.state();
    const urls = [...state.pending.urls];
    if (isWildcardHost(state.pending.host)) urls.push(`http://${state.hostname}:${state.pending.port}`);
    if (state.publicUrl !== null) urls.unshift(state.publicUrl);
    return [...new Set(urls)];
  }

  async save(input: NetworkInput): Promise<NetworkState> {
    return this.options.lock.run('network-settings', async () => {
      const next: StoredNetwork = { ...(await readStoredNetwork(this.store)) };
      if (input.bindHost !== undefined) {
        if (input.bindHost === null || input.bindHost.trim() === '') delete next.bindHost;
        else next.bindHost = this.validateBindHost(input.bindHost.trim());
      }
      if (input.port !== undefined) {
        if (input.port === null) delete next.port;
        else next.port = await this.validatePort(input.port);
      }
      if (input.allowedHosts !== undefined) {
        const hosts = this.validateHosts(input.allowedHosts);
        if (hosts.length === 0) delete next.allowedHosts;
        else next.allowedHosts = hosts;
      }
      if (input.publicAddress !== undefined) {
        if (input.publicAddress === null || input.publicAddress.trim() === '') delete next.publicAddress;
        else next.publicAddress = this.validatePublicAddress(input.publicAddress);
      }
      await this.store.set(KEY_NETWORK, Object.keys(next).length === 0 ? null : JSON.stringify(next));
      this.logger.info({}, 'Netzwerk-Einstellungen gespeichert (wirksam nach dem Neustart)');
      return this.toState(next);
    });
  }

  private validateBindHost(value: string): string {
    if (value === '0.0.0.0' || value === '127.0.0.1') return value;
    if (!net.isIPv4(value)) {
      throw new AppError(422, 'NETWORK_ADDRESS_INVALID', `„${value}“ ist keine gültige IPv4-Adresse. Erlaubt sind 0.0.0.0 (alle Adapter), 127.0.0.1 (nur dieser Rechner) oder eine Adresse dieses Rechners.`);
    }
    const local = localIPv4Addresses(this.interfaces());
    if (!local.includes(value)) {
      throw new AppError(
        422,
        'NETWORK_ADDRESS_UNKNOWN',
        `Die Adresse ${value} gehört zu keinem Netzwerkadapter dieses Rechners. Mit einer nicht vorhandenen Adresse wäre CraftManager nicht erreichbar.${local.length > 0 ? ` Vorhandene Adressen: ${local.join(', ')}.` : ''}`,
      );
    }
    return value;
  }

  private async validatePort(value: number): Promise<number> {
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      throw new AppError(422, 'NETWORK_PORT_INVALID', 'Der Port muss eine ganze Zahl zwischen 1 und 65535 sein.');
    }
    // the port this process listens on is naturally taken: by itself
    if (value === this.active.port) return value;
    const rows = await this.options.db.select({ name: servers.name }).from(servers).where(eq(servers.port, value));
    if (rows.length > 0) {
      throw new AppError(422, 'NETWORK_PORT_IN_USE', `Der Port ${value} ist dem Minecraft-Server „${rows[0]?.name ?? ''}“ zugeordnet. Bitte einen anderen Port für die Weboberfläche wählen.`);
    }
    const state = await this.options.probePort(value);
    if (state === 'in-use') {
      throw new AppError(422, 'NETWORK_PORT_IN_USE', `Der Port ${value} ist auf diesem Rechner bereits belegt. Bitte einen freien Port wählen.`);
    }
    if (state === 'denied') {
      throw new AppError(422, 'NETWORK_PORT_DENIED', `Für den Port ${value} fehlt die Berechtigung (Ports unter 1024 sind bei normalen Benutzerkonten gesperrt). Bitte einen höheren Port wählen.`);
    }
    return value;
  }

  private validateHosts(entries: string[]): string[] {
    const hosts: string[] = [];
    const invalid: string[] = [];
    for (const entry of entries) {
      if (entry.trim() === '') continue;
      const hostname = normalizeAllowedHost(entry);
      if (hostname === null) invalid.push(entry.trim());
      else if (!hosts.includes(hostname)) hosts.push(hostname);
    }
    if (invalid.length > 0) {
      throw new AppError(422, 'NETWORK_HOST_INVALID', `Ungültiger Rechnername: ${invalid.map((entry) => `„${entry}“`).join(', ')}. Erlaubt sind Namen wie minecraft.fritz.box (ohne http:// und ohne Pfad).`);
    }
    if (hosts.length > MAX_EXTRA_HOSTS) {
      throw new AppError(422, 'NETWORK_HOST_INVALID', `Es sind höchstens ${MAX_EXTRA_HOSTS} zusätzliche Rechnernamen möglich.`);
    }
    return hosts;
  }

  private validatePublicAddress(value: string): string {
    const parsed = normalizePublicAddress(value);
    if (parsed === null) {
      throw new AppError(422, 'NETWORK_PUBLIC_INVALID', 'Die öffentliche Adresse ist ungültig. Beispiele: minecraft.fritz.box oder http://192.168.178.20:3000');
    }
    return parsed.url;
  }
}
