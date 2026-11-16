import {feedbackStyles} from '../styles/feedback';
import {Tooltip} from '@base-ui/react/tooltip';
import * as stylex from '@stylexjs/stylex';
import {controlStyles} from '../styles/control-styles';
import {typography} from '../styles/typography.stylex';

import {useQuery} from '@tanstack/react-query';
import {desktopQueries} from '../queries';
import {Heading} from './heading';
import {Section} from './section';
import {
  TableContainer,
  TableRow,
  Table,
  TableCaption,
  TableHeaderCell,
  TableCell,
} from './table';

export function AddonTables({scenery = false}: {scenery?: boolean}) {
  const inventories = useQuery(desktopQueries.library);
  const library = inventories.data ?? [];
  return (
    <>
      <Heading>{scenery ? 'Scenery' : 'Addons'}</Heading>
      {inventories.isError && (
        <p role="alert" {...stylex.props(feedbackStyles.alert)}>
          Could not load addon library.
        </p>
      )}
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
                    {label} Airports (
                    <span {...stylex.props(styles.data)}>
                      {inventory.airports.length}
                    </span>
                    )
                  </TableCaption>
                  <thead>
                    <TableRow>
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
                    </TableRow>
                  </thead>
                  <tbody>
                    {inventory.airports.map(airport => (
                      <TableRow key={`${airport.folderName}/${airport.sourceKey}`}>
                        {[
                          airport.icaoCode ?? airport.iataCode,
                          airport.name,
                          airport.latitude,
                          airport.longitude,
                          airport.elevationMeters,
                        ].map((value, index) => (
                          <TableCell
                            key={index}
                            {...stylex.props(index !== 1 && styles.data)}
                          >
                            {value ?? 'Unknown'}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
              </TableContainer>
            )}
            {inventory.addons.length > 0 ? (
              <TableContainer>
                <Table>
                  <TableCaption>
                    {label} {scenery ? 'Scenery' : 'Addons'} (
                    <span {...stylex.props(styles.data)}>{inventory.addons.length}</span>)
                  </TableCaption>
                  <thead>
                    <TableRow>
                      <TableHeaderCell scope="col">Addon name</TableHeaderCell>
                      <TableHeaderCell scope="col">Folder</TableHeaderCell>
                    </TableRow>
                  </thead>
                  <tbody>
                    {inventory.addons.map(addon => (
                      <TableRow key={addon.folderName}>
                        <TableCell>{addon.name}</TableCell>
                        <TableCell {...stylex.props(styles.data)}>
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
                                  {...stylex.props(controlStyles.tooltip, styles.data)}
                                >
                                  {addon.folderPath}
                                </Tooltip.Popup>
                              </Tooltip.Positioner>
                            </Tooltip.Portal>
                          </Tooltip.Root>
                        </TableCell>
                      </TableRow>
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
  data: {fontFamily: typography.mono, fontWeight: 400},
});
