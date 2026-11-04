export const LOADERS = ['vanilla', 'fabric', 'neoforge', 'forge', 'paper'] as const;
export const INSTALL_STATES = ['pending', 'installing', 'installed', 'failed'] as const;
export const MOD_SOURCES = ['modrinth', 'manual'] as const;
export const DEPENDENCY_TYPES = ['required', 'optional', 'incompatible', 'embedded'] as const;
export const UPDATE_STATUSES = ['success', 'failed', 'rolled_back'] as const;

export type Loader = (typeof LOADERS)[number];
export type InstallState = (typeof INSTALL_STATES)[number];
export type ModSource = (typeof MOD_SOURCES)[number];
export type DependencyType = (typeof DEPENDENCY_TYPES)[number];
export type UpdateStatus = (typeof UPDATE_STATUSES)[number];
