import {Tooltip} from '@base-ui/react/tooltip';
import * as stylex from '@stylexjs/stylex';
import {useQuery} from '@tanstack/react-query';
import {desktopQueries} from '../queries';
import {Heading} from './heading';
import {Section} from './section';
import {TableContainer, Table, TableCaption, TableHeaderCell, TableCell} from './table';

export function AddonTables({scenery = false}: {scenery?: boolean}) {
  const inventories = useQuery(desktopQueries.library);
  const library = inventories.data ?? [];
  return (
    <>
      <Heading>{scenery ? 'Scenery' : 'Addons'}</Heading>
      {inventories.isError && <p role="alert">Could not load addon library.</p>}
      {library.map(source => {
        const inventory = {
          ...source,
          addons: source.addons
            .filter(addon => !scenery || addon.contentType?.toUpperCase() === 'SCENERY')
            .toSorted((a, b) => a.name.localeCompare(b.name)),
          airports: source.airports.toSorted((a, b) =>
            (a.name ?? '').localeCompare(b.name ?? '')
          ),
        };
        const label = inventory.simulator === 'msfs2020' ? 'MSFS 2020' : 'MSFS 2024';
        return (
          <Section key={inventory.simulator} aria-label={label}>
            <Heading as="h3">{label}</Heading>
            {scenery && inventory.airports.length > 0 && (
              <TableContainer>
                <Table>
                  <TableCaption>
                    {label} Airports ({inventory.airports.length})
                  </TableCaption>
                  <thead>
                    <tr>
                      {[
                        'Code',
                        'Airport name',
                        'Latitude',
                        'Longitude',
                        'Elevation (m)',
                      ].map(label => (
                        <TableHeaderCell key={label} scope="col">
                          {label}
                        </TableHeaderCell>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.airports.map(airport => (
                      <tr key={`${airport.folderName}/${airport.sourceKey}`}>
                        {[
                          airport.icaoCode ?? airport.iataCode,
                          airport.name,
                          airport.latitude,
                          airport.longitude,
                          airport.elevationMeters,
                        ].map((value, index) => (
                          <TableCell key={index}>{value ?? 'Unknown'}</TableCell>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableContainer>
            )}
            {inventory.addons.length > 0 ? (
              <TableContainer>
                <Table>
                  <TableCaption>
                    {label} {scenery ? 'Scenery' : 'Addons'} ({inventory.addons.length})
                  </TableCaption>
                  <thead>
                    <tr>
                      <TableHeaderCell scope="col">Addon name</TableHeaderCell>
                      <TableHeaderCell scope="col">Folder</TableHeaderCell>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.addons.map(addon => (
                      <tr key={addon.folderName}>
                        <TableCell>{addon.name}</TableCell>
                        <TableCell {...stylex.props(styles.folder)}>
                          <Tooltip.Root>
                            <Tooltip.Trigger
                              render={<span />}
                              tabIndex={0}
                              aria-describedby={`${inventory.simulator}-${encodeURIComponent(addon.folderName)}-path`}
                            >
                              {addon.folderName}
                            </Tooltip.Trigger>
                            <Tooltip.Portal>
                              <Tooltip.Positioner sideOffset={8}>
                                <Tooltip.Popup
                                  id={`${inventory.simulator}-${encodeURIComponent(addon.folderName)}-path`}
                                  role="tooltip"
                                  {...stylex.props(styles.tooltip)}
                                >
                                  {addon.folderPath}
                                </Tooltip.Popup>
                              </Tooltip.Positioner>
                            </Tooltip.Portal>
                          </Tooltip.Root>
                        </TableCell>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableContainer>
            ) : (
              <p>
                {inventory.scannedAt
                  ? scenery
                    ? 'No scenery found in the last scan.'
                    : 'No addons found in the last scan.'
                  : 'Save your Community folder and scan to list installed addons.'}
              </p>
            )}
          </Section>
        );
      })}
    </>
  );
}

const styles = stylex.create({
  folder: {fontFamily: 'monospace'},
  tooltip: {
    padding: 8,
    backgroundColor: '#242424',
    color: '#fff',
    borderRadius: 4,
    maxWidth: 400,
    overflowWrap: 'anywhere',
  },
});
