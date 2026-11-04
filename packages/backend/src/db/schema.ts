import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { DEPENDENCY_TYPES, INSTALL_STATES, LOADERS, MOD_SOURCES, UPDATE_STATUSES } from './enums.js';

export const servers = sqliteTable(
  'servers',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    loader: text('loader', { enum: LOADERS }).notNull(),
    mcVersion: text('mc_version').notNull(),
    loaderVersion: text('loader_version'),
    installState: text('install_state', { enum: INSTALL_STATES }).notNull().default('pending'),
    installError: text('install_error'),
    launchSpec: text('launch_spec'),
    requiredJavaMajor: integer('required_java_major'),
    port: integer('port').notNull().default(25565),
    javaPath: text('java_path'),
    minRamMb: integer('min_ram_mb').notNull().default(1024),
    maxRamMb: integer('max_ram_mb').notNull().default(2048),
    useAikarFlags: integer('use_aikar_flags', { mode: 'boolean' }).notNull().default(false),
    extraJvmArgs: text('extra_jvm_args').notNull().default(''),
    eulaAccepted: integer('eula_accepted', { mode: 'boolean' }).notNull().default(false),
    lastStartedAt: integer('last_started_at', { mode: 'timestamp_ms' }),
    lastExitCode: integer('last_exit_code'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('servers_port_idx').on(t.port)],
);

export const mods = sqliteTable(
  'mods',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    source: text('source', { enum: MOD_SOURCES }).notNull(),
    projectId: text('project_id'),
    versionId: text('version_id'),
    versionNumber: text('version_number'),
    name: text('name').notNull(),
    fileName: text('file_name').notNull(),
    sha512: text('sha512').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    isDependency: integer('is_dependency', { mode: 'boolean' }).notNull().default(false),
    installedAt: integer('installed_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    unique('mods_server_file_name_uq').on(t.serverId, t.fileName),
    unique('mods_server_sha512_uq').on(t.serverId, t.sha512),
    unique('mods_server_project_uq').on(t.serverId, t.projectId),
  ],
);

export const modDependencies = sqliteTable(
  'mod_dependencies',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    modId: text('mod_id')
      .notNull()
      .references(() => mods.id, { onDelete: 'cascade' }),
    dependencyType: text('dependency_type', { enum: DEPENDENCY_TYPES }).notNull(),
    projectId: text('project_id'),
    versionId: text('version_id'),
    fileName: text('file_name'),
    dependsOnModId: text('depends_on_mod_id').references(() => mods.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('mod_dependencies_mod_id_idx').on(t.modId),
    index('mod_dependencies_depends_on_mod_id_idx').on(t.dependsOnModId),
  ],
);

export const modUpdateLog = sqliteTable(
  'mod_update_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    modId: text('mod_id').references(() => mods.id, { onDelete: 'set null' }),
    modName: text('mod_name').notNull(),
    fromVersionId: text('from_version_id'),
    toVersionId: text('to_version_id'),
    fromFileName: text('from_file_name'),
    toFileName: text('to_file_name'),
    backupPath: text('backup_path'),
    status: text('status', { enum: UPDATE_STATUSES }).notNull(),
    error: text('error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('mod_update_log_server_created_idx').on(t.serverId, t.createdAt)],
);

export type Server = typeof servers.$inferSelect;
export type NewServer = typeof servers.$inferInsert;
export type Mod = typeof mods.$inferSelect;
export type NewMod = typeof mods.$inferInsert;
export type ModDependency = typeof modDependencies.$inferSelect;
export type NewModDependency = typeof modDependencies.$inferInsert;
export type ModUpdateLogEntry = typeof modUpdateLog.$inferSelect;
export type NewModUpdateLogEntry = typeof modUpdateLog.$inferInsert;
