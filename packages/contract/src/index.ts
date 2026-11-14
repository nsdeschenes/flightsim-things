export const runtimeHealthChannel = 'runtime:health';
export const addonLibraryChannel = 'addons:library';
export const saveCommunityPathChannel = 'addons:save-community-path';
export const scanAddonsChannel = 'addons:scan';

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

export interface SimulatorInventory {
  simulator: SimulatorId;
  communityPath: string | null;
  scannedPath: string | null;
  scannedAt: string | null;
  addons: Addon[];
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

export interface DesktopApi {
  getRuntimeHealth(): Promise<RuntimeHealth>;
  getAddonLibrary(): Promise<SimulatorInventory[]>;
  saveCommunityPath(simulator: SimulatorId, path: string): Promise<SimulatorInventory>;
  scanAddons(simulator: SimulatorId): Promise<ScanResult>;
}
