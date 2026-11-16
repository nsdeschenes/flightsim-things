import {feedbackStyles} from '../../styles/feedback';
import {Field} from '@base-ui/react/field';
import {Select} from '@base-ui/react/select';
import {Tooltip} from '@base-ui/react/tooltip';
import * as stylex from '@stylexjs/stylex';
import {controlStyles} from '../../styles/control-styles';
import {colors} from '../../styles/colors.stylex';
import {spacing} from '../../styles/spacing.stylex';
import {radii} from '../../styles/radii.stylex';
import {typography} from '../../styles/typography.stylex';

import {useForm} from '@tanstack/react-form';
import {useQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import {useMemo, useState} from 'react';
import {desktopQueries} from '../../queries';
import {Button} from '../button';
import {Controls} from '../controls';
import {FieldControl} from '../field-control';
import {Heading} from '../heading';
import {Section} from '../section';
import {
  TableContainer,
  TableRow,
  Table,
  TableCaption,
  TableHeaderCell,
  TableCell,
} from '../table';
import {installations, locationGroups, simulatorLabel, type Installation} from './model';
import {SceneryMap} from './scenery-map';

export function SceneryLibrary() {
  const query = useQuery(desktopQueries.library);
  const records = useMemo(() => installations(query.data ?? []), [query.data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const form = useForm({defaultValues: {search: '', simulator: 'all', location: 'all'}});

  return (
    <>
      <Heading>Scenery</Heading>
      {!window.desktop ? (
        <p>Open the desktop app to view installed scenery.</p>
      ) : query.isPending ? (
        <p>Loading scenery library…</p>
      ) : null}
      {query.isError && (
        <div>
          <p role="alert" {...stylex.props(feedbackStyles.alert)}>
            Could not load addon library.
          </p>
          <Button onClick={() => void query.refetch()}>Try again</Button>
        </div>
      )}
      <form
        noValidate
        onSubmit={event => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <Controls>
          <form.Field name="search">
            {field => (
              <Field.Root
                {...stylex.props(styles.filterField)}
                name={field.name}
                dirty={field.state.meta.isDirty}
                touched={field.state.meta.isTouched}
                invalid={!field.state.meta.isValid}
              >
                <Field.Label {...stylex.props(feedbackStyles.label)}>
                  Search scenery
                </Field.Label>
                <FieldControl
                  name={field.name}
                  value={field.state.value}
                  onValueChange={field.handleChange}
                  onBlur={field.handleBlur}
                  placeholder="Airport, code, package, folder"
                />
              </Field.Root>
            )}
          </form.Field>
          <form.Field name="simulator">
            {field => (
              <Field.Root
                {...stylex.props(styles.filterField)}
                name={field.name}
                dirty={field.state.meta.isDirty}
                touched={field.state.meta.isTouched}
                invalid={!field.state.meta.isValid}
              >
                <Field.Label {...stylex.props(feedbackStyles.label)}>
                  Simulator
                </Field.Label>
                <FilterSelect
                  items={{
                    all: 'All simulators',
                    msfs2020: 'MSFS 2020',
                    msfs2024: 'MSFS 2024',
                  }}
                  name={field.name}
                  value={field.state.value}
                  onValueChange={field.handleChange}
                  onBlur={field.handleBlur}
                />
              </Field.Root>
            )}
          </form.Field>
          <form.Field name="location">
            {field => (
              <Field.Root
                {...stylex.props(styles.filterField)}
                name={field.name}
                dirty={field.state.meta.isDirty}
                touched={field.state.meta.isTouched}
                invalid={!field.state.meta.isValid}
              >
                <Field.Label {...stylex.props(feedbackStyles.label)}>
                  Location
                </Field.Label>
                <FilterSelect
                  items={{
                    all: 'All locations',
                    mapped: 'With coordinates',
                    missing: 'Without coordinates',
                  }}
                  name={field.name}
                  value={field.state.value}
                  onValueChange={field.handleChange}
                  onBlur={field.handleBlur}
                />
              </Field.Root>
            )}
          </form.Field>
          <Button onClick={() => form.reset()}>Clear filters</Button>
        </Controls>
      </form>
      <form.Subscribe selector={state => state.values}>
        {filters => {
          const search = filters.search.trim().toLocaleLowerCase();
          const filtered = records.filter(
            record =>
              (filters.simulator === 'all' || record.simulator === filters.simulator) &&
              (filters.location === 'all' ||
                (filters.location === 'mapped'
                  ? record.position !== null
                  : record.position === null)) &&
              [
                record.name,
                record.folderName,
                record.package?.name,
                record.package?.creator,
                record.kind === 'airport' ? record.airport.icaoCode : '',
                record.kind === 'airport' ? record.airport.iataCode : '',
              ]
                .join(' ')
                .toLocaleLowerCase()
                .includes(search)
          );
          const selected = filtered.find(record => record.id === selectedId);
          const groups = locationGroups(filtered);
          const mappedCount = filtered.filter(record => record.position !== null).length;
          const coincident = selected?.position
            ? (groups.find(
                group =>
                  JSON.stringify(group.position) === JSON.stringify(selected.position)
              )?.records ?? [])
            : [];
          return (
            <>
              <p aria-live="polite" {...stylex.props(styles.summary)}>
                {filtered.length} installations · {mappedCount} mapped ·{' '}
                {filtered.length - mappedCount} without coordinates · {groups.length} map
                locations
              </p>
              <SceneryMap
                records={filtered}
                selectedId={selected?.id ?? null}
                focusPosition={selected?.position ?? null}
                onSelect={setSelectedId}
              />
              {query.isSuccess && filtered.length === 0 && (
                <p>
                  {records.length === 0
                    ? 'No scenery found. Save your Community folder and scan in Settings.'
                    : 'No scenery matches these filters. Clear filters to see your inventory.'}{' '}
                  <Link to="/settings">Open Settings</Link>
                </p>
              )}
              {filtered.length > 0 && mappedCount === 0 && (
                <p>
                  No coordinates available for this view. Scan and enrich airports in
                  Settings. Scenery packages have no airport point.
                </p>
              )}
              <Section aria-label="Installation details">
                <Heading as="h3">Installation details</Heading>
                {selected ? (
                  <>
                    <h4>{selected.name}</h4>
                    <p>
                      {simulatorLabel(selected.simulator)} ·{' '}
                      {selected.kind === 'airport' ? 'Airport' : 'Scenery package'}
                    </p>
                    <dl {...stylex.props(styles.details)}>
                      <dt>Package</dt>
                      <dd>{selected.package?.name ?? 'Package metadata unavailable'}</dd>
                      <dt>Folder</dt>
                      <dd>{selected.folderName}</dd>
                      <dt>Path</dt>
                      <dd>{selected.package?.folderPath ?? 'Unknown'}</dd>
                      <dt>Creator</dt>
                      <dd>{selected.package?.creator ?? 'Unknown'}</dd>
                      <dt>Version</dt>
                      <dd>{selected.package?.version ?? 'Unknown'}</dd>
                      {selected.kind === 'airport' && (
                        <>
                          <dt>Code</dt>
                          <dd>
                            {selected.airport.icaoCode ??
                              selected.airport.iataCode ??
                              'Unknown'}
                          </dd>
                          <dt>Elevation (m)</dt>
                          <dd>{selected.airport.elevationMeters ?? 'Unknown'}</dd>
                        </>
                      )}
                      <dt>Coordinates</dt>
                      <dd>
                        {selected.position
                          ? `${selected.position[1]}, ${selected.position[0]}`
                          : 'Unavailable. Enrich airports in Settings to look up missing locations.'}
                      </dd>
                    </dl>
                    {coincident.length > 1 && (
                      <div role="group" aria-label="Installations at this location">
                        <p>{coincident.length} installations at this location</p>
                        <Controls>
                          {coincident.map(record => (
                            <Button
                              key={record.id}
                              aria-pressed={selected.id === record.id}
                              onClick={() => setSelectedId(record.id)}
                            >
                              {record.name} · {simulatorLabel(record.simulator)} ·{' '}
                              {record.folderName}
                            </Button>
                          ))}
                        </Controls>
                      </div>
                    )}
                  </>
                ) : (
                  <p>
                    {selectedId
                      ? 'The selected installation is outside this view or no longer installed. Select an installation below.'
                      : 'Select an airport on the map or an installation in the inventory. Selection keeps the current map view; Focus airport moves it.'}
                  </p>
                )}
              </Section>
              {(query.data ?? []).map(inventory => {
                const simulatorRecords = filtered.filter(
                  record => record.simulator === inventory.simulator
                );
                const label = simulatorLabel(inventory.simulator);
                return (
                  <Section key={inventory.simulator} aria-label={label}>
                    <Heading as="h3">{label}</Heading>
                    {!inventory.scannedAt && (
                      <p>Save your Community folder and scan to list installed addons.</p>
                    )}
                    {(['airport', 'scenery'] as const).map(kind => {
                      const rows = simulatorRecords.filter(
                        record => record.kind === kind
                      );
                      if (!rows.length) {
                        return null;
                      }
                      return (
                        <TableContainer key={kind}>
                          <Table>
                            <TableCaption>
                              {label} {kind === 'airport' ? 'Airports' : 'Scenery'} (
                              {rows.length})
                            </TableCaption>
                            <thead>
                              <TableRow>
                                {(kind === 'airport'
                                  ? [
                                      'Code',
                                      'Airport name',
                                      'Latitude',
                                      'Longitude',
                                      'Elevation (m)',
                                      'Folder',
                                    ]
                                  : ['Addon name', 'Folder']
                                ).map(title => (
                                  <TableHeaderCell key={title} scope="col">
                                    {title}
                                  </TableHeaderCell>
                                ))}
                              </TableRow>
                            </thead>
                            <tbody>
                              {rows.map(record => (
                                <TableRow
                                  key={record.id}
                                  aria-selected={selected?.id === record.id}
                                >
                                  {record.kind === 'airport' && (
                                    <TableCell>
                                      {record.airport.icaoCode ??
                                        record.airport.iataCode ??
                                        'Unknown'}
                                    </TableCell>
                                  )}
                                  <TableCell>
                                    <Button
                                      aria-pressed={selected?.id === record.id}
                                      onClick={() => setSelectedId(record.id)}
                                    >
                                      {record.name}
                                    </Button>
                                  </TableCell>
                                  {record.kind === 'airport' &&
                                    [
                                      record.airport.latitude,
                                      record.airport.longitude,
                                      record.airport.elevationMeters,
                                    ].map((value, index) => (
                                      <TableCell key={index}>
                                        {value !== null && Number.isFinite(value)
                                          ? value
                                          : 'Unknown'}
                                      </TableCell>
                                    ))}
                                  <TableCell>
                                    <Folder record={record} />
                                  </TableCell>
                                </TableRow>
                              ))}
                            </tbody>
                          </Table>
                        </TableContainer>
                      );
                    })}
                    {inventory.scannedAt && !simulatorRecords.length && (
                      <p>No scenery found in this view.</p>
                    )}
                  </Section>
                );
              })}
            </>
          );
        }}
      </form.Subscribe>
    </>
  );
}

function FilterSelect({
  items,
  name,
  value,
  onValueChange,
  onBlur,
}: {
  items: Record<string, string>;
  name: string;
  value: string;
  onValueChange: (value: string) => void;
  onBlur: () => void;
}) {
  return (
    <Select.Root
      items={items}
      name={name}
      value={value}
      onValueChange={next => {
        if (next !== null) {
          onValueChange(next);
        }
      }}
    >
      <Select.Trigger
        onBlur={onBlur}
        {...stylex.props(controlStyles.root, styles.selectTrigger)}
      >
        <Select.Value />
        <Select.Icon>▾</Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={4}>
          <Select.Popup {...stylex.props(styles.selectPopup)}>
            <Select.List>
              {Object.entries(items).map(([itemValue, label]) => (
                <Select.Item
                  key={itemValue}
                  value={itemValue}
                  {...stylex.props(styles.selectItem)}
                >
                  <Select.ItemText>{label}</Select.ItemText>
                  <Select.ItemIndicator>✓</Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

function Folder({record}: {record: Installation}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={<span />} tabIndex={0} {...stylex.props(styles.folder)}>
        {record.folderName}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={8}>
          <Tooltip.Popup role="tooltip" {...stylex.props(controlStyles.tooltip)}>
            {record.package?.folderPath ?? 'Package path unavailable'}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
const styles = stylex.create({
  filterField: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.xs,
    flexGrow: 1,
    flexBasis: 180,
    minWidth: 0,
  },
  selectTrigger: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    minWidth: 180,
    width: '100%',
  },
  selectPopup: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.controlBorder,
    borderRadius: radii.control,
    padding: spacing.xs,
    minWidth: 'var(--anchor-width)',
    maxHeight: 'var(--available-height)',
    overflowY: 'auto',
    zIndex: 10,
  },
  selectItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    padding: spacing.sm,
    borderRadius: radii.sm,
    cursor: 'pointer',
    backgroundColor: {
      default: colors.transparent,
      ':is([data-selected])': colors.selected,
      ':is([data-highlighted])': colors.primary,
    },
    color: {
      default: colors.text,
      ':is([data-selected])': colors.onSelected,
      ':is([data-highlighted])': colors.onPrimary,
    },
    outlineStyle: 'none',
  },
  summary: {marginBlock: spacing.lg, color: colors.textMuted},
  details: {
    display: 'grid',
    gridTemplateColumns: 'minmax(80px, auto) minmax(0, 1fr)',
    gap: 8,
    overflowWrap: 'anywhere',
  },
  folder: {fontFamily: typography.mono},
});
