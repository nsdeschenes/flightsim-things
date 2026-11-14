export const runtimeHealthChannel = 'runtime:health';
export const addonLibraryChannel = 'addons:library';
export const saveCommunityPathChannel = 'addons:save-community-path';
export const scanAddonsChannel = 'addons:scan';
export const enrichAirportsChannel = 'airports:enrich';
export const openAipKeyStatusChannel = 'openaip:key-status';
export const saveOpenAipKeyChannel = 'openaip:save-key';
export const removeOpenAipKeyChannel = 'openaip:remove-key';

export const simulators = ['msfs2020', 'msfs2024'] as const;
export type SimulatorId = (typeof simulators)[number];

export interface Addon {
  simulator: SimulatorId;
  folderName: string;
  folderPath: string;
  name: string;
  version: string | null;
  creator: string | null;
  contentType: string | null;
  manifestJson: string;
}

export interface Airport {
  simulator: SimulatorId;
  folderName: string;
  sourceKey: string;
  icaoCode: string | null;
  iataCode: string | null;
  name: string | null;
  elevationMeters: number | null;
  latitude: number | null;
  longitude: number | null;
}

export interface EnrichmentSummary {
  airports: number;
  enriched: number;
  unmatched: number;
  ambiguous: number;
  skipped: number;
}

export interface EnrichmentResult {
  inventory: SimulatorInventory;
  summary: EnrichmentSummary;
}

export interface SimulatorInventory {
  simulator: SimulatorId;
  communityPath: string | null;
  scannedPath: string | null;
  scannedAt: string | null;
  addons: Addon[];
  airports: Airport[];
}

export interface ScanWarning {
  folderName: string;
  message: string;
}

export interface ScanResult {
  inventory: SimulatorInventory;
  warnings: ScanWarning[];
}

export interface RuntimeHealth {
  status: 'ready';
  database: 'connected';
}

export interface OpenAipKeyStatus {
  saved: boolean;
  available: boolean;
}

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
