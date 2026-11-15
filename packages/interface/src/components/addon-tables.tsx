import {Tooltip} from '@base-ui/react/tooltip';
import * as stylex from '@stylexjs/stylex';
import {useLibrary} from '../app-state';
import {styles} from '../styles';

export function AddonTables({scenery = false}: {scenery?: boolean}) {
  const {library} = useLibrary();
  return (
    <>
      <h2 {...stylex.props(styles.subheading)}>{scenery ? 'Scenery' : 'Addons'}</h2>
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
          <section
            key={inventory.simulator}
            aria-label={label}
            {...stylex.props(styles.section)}
          >
            <h3 {...stylex.props(styles.subheading)}>{label}</h3>
            {scenery && inventory.airports.length > 0 && (
              <div {...stylex.props(styles.tableContainer)}>
                <table {...stylex.props(styles.table)}>
                  <caption {...stylex.props(styles.caption)}>
                    {label} Airports ({inventory.airports.length})
                  </caption>
                  <thead>
                    <tr>
                      {[
                        'Code',
                        'Airport name',
                        'Latitude',
                        'Longitude',
                        'Elevation (m)',
                      ].map(label => (
                        <th key={label} scope="col" {...stylex.props(styles.cell)}>
                          {label}
                        </th>
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
                          <td key={index} {...stylex.props(styles.cell)}>
                            {value ?? 'Unknown'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {inventory.addons.length > 0 ? (
              <div {...stylex.props(styles.tableContainer)}>
                <table {...stylex.props(styles.table)}>
                  <caption {...stylex.props(styles.caption)}>
                    {label} {scenery ? 'Scenery' : 'Addons'} ({inventory.addons.length})
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" {...stylex.props(styles.cell)}>
                        Addon name
                      </th>
                      <th scope="col" {...stylex.props(styles.cell)}>
                        Folder
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.addons.map(addon => (
                      <tr key={addon.folderName}>
                        <td {...stylex.props(styles.cell)}>{addon.name}</td>
                        <td {...stylex.props(styles.cell, styles.folder)}>
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
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>
                {inventory.scannedAt
                  ? scenery
                    ? 'No scenery found in the last scan.'
                    : 'No addons found in the last scan.'
                  : 'Save your Community folder and scan to list installed addons.'}
              </p>
            )}
          </section>
        );
      })}
    </>
  );
}
