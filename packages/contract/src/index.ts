import {createSelectSchema} from 'drizzle-orm/effect-schema';
import {Schema, Struct} from 'effect';

import {simulators} from './simulators.js';
import type {SimulatorId} from './simulators.js';
import {addons, airports} from './tables.js';

export const runtimeHealthChannel = 'runtime:health';
export const addonLibraryChannel = 'addons:library';
export const saveCommunityPathChannel = 'addons:save-community-path';
export const scanAddonsChannel = 'addons:scan';
export const enrichAirportsChannel = 'airports:enrich';
export const openAipKeyStatusChannel = 'openaip:key-status';
export const saveOpenAipKeyChannel = 'openaip:save-key';
export const removeOpenAipKeyChannel = 'openaip:remove-key';

export {simulators} from './simulators.js';
export type {SimulatorId} from './simulators.js';
export const simulatorIdSchema = Schema.Literals(simulators);

export const addonSchema = createSelectSchema(addons, {
  simulator: simulatorIdSchema,
}).mapFields(Struct.map(Schema.mutableKey));
export type Addon = typeof addonSchema.Type;

export const airportSchema = createSelectSchema(airports, {
  simulator: simulatorIdSchema,
}).mapFields(Struct.map(Schema.mutableKey));
export type Airport = typeof airportSchema.Type;

export const enrichmentSummarySchema = Schema.Struct({
  airports: Schema.Number,
  enriched: Schema.Number,
  unmatched: Schema.Number,
  ambiguous: Schema.Number,
  skipped: Schema.Number,
}).mapFields(Struct.map(Schema.mutableKey));
export type EnrichmentSummary = typeof enrichmentSummarySchema.Type;

export const simulatorInventorySchema = Schema.Struct({
  simulator: simulatorIdSchema,
  communityPath: Schema.NullOr(Schema.String),
  scannedPath: Schema.NullOr(Schema.String),
  scannedAt: Schema.NullOr(Schema.String),
  addons: Schema.mutable(Schema.Array(addonSchema)),
  airports: Schema.mutable(Schema.Array(airportSchema)),
}).mapFields(Struct.map(Schema.mutableKey));
export type SimulatorInventory = typeof simulatorInventorySchema.Type;

export const addonLibrarySchema = Schema.mutable(Schema.Array(simulatorInventorySchema));

export const enrichmentResultSchema = Schema.Struct({
  inventory: simulatorInventorySchema,
  summary: enrichmentSummarySchema,
}).mapFields(Struct.map(Schema.mutableKey));
export type EnrichmentResult = typeof enrichmentResultSchema.Type;

export const scanWarningSchema = Schema.Struct({
  folderName: Schema.String,
  message: Schema.String,
}).mapFields(Struct.map(Schema.mutableKey));
export type ScanWarning = typeof scanWarningSchema.Type;

export const scanResultSchema = Schema.Struct({
  inventory: simulatorInventorySchema,
  warnings: Schema.mutable(Schema.Array(scanWarningSchema)),
}).mapFields(Struct.map(Schema.mutableKey));
export type ScanResult = typeof scanResultSchema.Type;

export const runtimeHealthSchema = Schema.Struct({
  status: Schema.Literal('ready'),
  database: Schema.Literal('connected'),
}).mapFields(Struct.map(Schema.mutableKey));
export type RuntimeHealth = typeof runtimeHealthSchema.Type;

export const openAipKeyStatusSchema = Schema.Struct({
  saved: Schema.Boolean,
  available: Schema.Boolean,
}).mapFields(Struct.map(Schema.mutableKey));
export type OpenAipKeyStatus = typeof openAipKeyStatusSchema.Type;

export interface DesktopApi {
  getOpenAipKeyStatus(): Promise<OpenAipKeyStatus>;
  saveOpenAipKey(key: string): Promise<OpenAipKeyStatus>;
  removeOpenAipKey(): Promise<OpenAipKeyStatus>;
  getRuntimeHealth(): Promise<RuntimeHealth>;
  getAddonLibrary(): Promise<SimulatorInventory[]>;
  saveCommunityPath(simulator: SimulatorId, path: string): Promise<SimulatorInventory>;
  scanAddons(simulator: SimulatorId): Promise<ScanResult>;
  enrichAirports(simulator: SimulatorId, apiKey?: string): Promise<EnrichmentResult>;
}
