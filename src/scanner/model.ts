import type schema from '#database-schema';

type PackageMetadata = Readonly<Omit<typeof schema.packages.$inferInsert, 'id'>>;
type AircraftObservation = Readonly<
  Omit<typeof schema.aircraft.$inferInsert, 'id' | 'packageId'>
>;
type AirportObservation = Readonly<
  Omit<typeof schema.airports.$inferInsert, 'id' | 'packageId'>
>;
type LiveryObservation = Readonly<
  Omit<
    typeof schema.liveries.$inferInsert,
    'id' | 'packageId' | 'aircraftId' | 'airlineId'
  > & {
    airlineCode: string | null;
    airlineName: string | null;
  }
>;
type PackageSnapshot = Readonly<{
  metadata: PackageMetadata;
  aircraft: readonly AircraftObservation[];
  airports: readonly AirportObservation[];
  liveries: readonly LiveryObservation[];
  hasCompiledScenery: boolean;
  skippedXmlFiles: readonly string[];
  warnings: readonly string[];
}>;

export type {PackageSnapshot as default};
