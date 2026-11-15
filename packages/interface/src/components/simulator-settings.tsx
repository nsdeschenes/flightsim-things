import {Button} from '@base-ui/react/button';
import {Collapsible} from '@base-ui/react/collapsible';
import {Field} from '@base-ui/react/field';
import * as stylex from '@stylexjs/stylex';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import {revalidateLogic, useForm, useStore} from '@tanstack/react-form';
import type {
  EnrichmentSummary,
  ScanWarning,
  SimulatorInventory,
} from '@flightsim-things/contract';
import {desktopQueries} from '../queries';
import {styles} from '../styles';

type Activity =
  | {kind: 'idle'}
  | {kind: 'saving' | 'scanning' | 'enriching'}
  | {kind: 'saved'}
  | {kind: 'scanned'; warnings: ScanWarning[]}
  | {kind: 'enriched'; summary: EnrichmentSummary}
  | {kind: 'error'; message: string};

export function SimulatorSettings({
  inventory,
  apiKey,
  canUseSavedKey,
}: {
  inventory: SimulatorInventory;
  apiKey: string;
  canUseSavedKey: boolean;
}) {
  const form = useForm({
    defaultValues: {communityPath: inventory.communityPath ?? ''},
    validationLogic: revalidateLogic(),
    onSubmit: () => {
      if (!mutation.isPending) {
        mutation.mutate('saving');
      }
    },
  });
  const path = useStore(form.store, state => state.values.communityPath);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (action: 'saving' | 'scanning' | 'enriching') => {
      const desktop = window.desktop!;
      if (action === 'saving') {
        const updated = await desktop.saveCommunityPath(inventory.simulator, path);
        return {inventory: updated, activity: {kind: 'saved'} satisfies Activity};
      }
      if (action === 'scanning') {
        const result = await desktop.scanAddons(inventory.simulator);
        return {
          inventory: result.inventory,
          activity: {kind: 'scanned', warnings: result.warnings} satisfies Activity,
        };
      }
      const result = await desktop.enrichAirports(
        inventory.simulator,
        apiKey.trim() ? apiKey : undefined
      );
      return {
        inventory: result.inventory,
        activity: {kind: 'enriched', summary: result.summary} satisfies Activity,
      };
    },
    onSuccess: async result => {
      await queryClient.cancelQueries({queryKey: desktopQueries.library.queryKey});
      queryClient.setQueryData(
        desktopQueries.library.queryKey,
        (current: SimulatorInventory[] | undefined) =>
          current?.map(item =>
            item.simulator === result.inventory.simulator ? result.inventory : item
          )
      );
    },
  });
  const busy = mutation.isPending;
  const activity: Activity = mutation.isPending
    ? {kind: mutation.variables}
    : mutation.isError
      ? {kind: 'error', message: mutation.error.message}
      : (mutation.data?.activity ?? {kind: 'idle'});
  const dirty = path !== (inventory.communityPath ?? '');
  const label = inventory.simulator === 'msfs2020' ? 'MSFS 2020' : 'MSFS 2024';

  return (
    <section aria-label={label} {...stylex.props(styles.section)}>
      <h2 {...stylex.props(styles.subheading)}>{label}</h2>
      <form
        noValidate
        onSubmit={event => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field
          name="communityPath"
          validators={{
            onDynamic: ({value}) =>
              !value.trim() ? 'Enter a Community folder path.' : undefined,
          }}
        >
          {field => (
            <Field.Root
              name={field.name}
              invalid={!field.state.meta.isValid}
              dirty={field.state.meta.isDirty}
              touched={field.state.meta.isTouched}
              disabled={busy}
            >
              <Field.Label htmlFor={`${inventory.simulator}-path`}>
                Community folder
              </Field.Label>
              <div {...stylex.props(styles.controls)}>
                <Field.Control
                  id={`${inventory.simulator}-path`}
                  type="text"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onValueChange={value => {
                    field.handleChange(value);
                    mutation.reset();
                  }}
                  disabled={busy}
                  placeholder="Enter the full Community folder path"
                  {...stylex.props(styles.input)}
                />
                <Button
                  type="submit"
                  disabled={busy || !path.trim()}
                  {...stylex.props(styles.button)}
                >
                  {activity.kind === 'saving' ? 'Saving…' : 'Save path'}
                </Button>
                <Button
                  type="button"
                  onClick={() => mutation.mutate('scanning')}
                  disabled={busy || dirty || !inventory.communityPath}
                  {...stylex.props(styles.button)}
                >
                  {activity.kind === 'scanning' ? 'Scanning…' : 'Scan addons'}
                </Button>
              </div>
              <Field.Error match={!field.state.meta.isValid}>
                {field.state.meta.errors.join(', ')}
              </Field.Error>
            </Field.Root>
          )}
        </form.Field>
      </form>
      <div {...stylex.props(styles.controls)}>
        <Button
          type="button"
          onClick={() => mutation.mutate('enriching')}
          disabled={
            busy || (!apiKey.trim() && !canUseSavedKey) || inventory.airports.length === 0
          }
          {...stylex.props(styles.button)}
        >
          {activity.kind === 'enriching' ? 'Enriching…' : 'Enrich airports'}
        </Button>
      </div>
      <div aria-live="polite" {...stylex.props(styles.feedback)}>
        {dirty && <p>Save the path before scanning.</p>}
        {activity.kind === 'saved' && <p>Community folder saved.</p>}
        {activity.kind === 'scanned' && (
          <p>
            Scan complete. Found {inventory.addons.length} addons. Skipped{' '}
            {activity.warnings.length} folders.
          </p>
        )}
        {activity.kind === 'enriched' && (
          <p>
            Updated {activity.summary.enriched} airports. Unmatched{' '}
            {activity.summary.unmatched}. Ambiguous {activity.summary.ambiguous}. Skipped{' '}
            {activity.summary.skipped}.
          </p>
        )}
        {activity.kind === 'error' && <p role="alert">{activity.message}</p>}
        {activity.kind === 'scanned' && activity.warnings.length > 0 && (
          <Collapsible.Root>
            <Collapsible.Trigger {...stylex.props(styles.button)}>
              Skipped folders
            </Collapsible.Trigger>
            <Collapsible.Panel>
              <ul>
                {activity.warnings.map(warning => (
                  <li key={warning.folderName}>
                    {warning.folderName}: {warning.message}
                  </li>
                ))}
              </ul>
            </Collapsible.Panel>
          </Collapsible.Root>
        )}
      </div>
      {inventory.scannedAt && (
        <p {...stylex.props(styles.scanInfo)}>
          Last scan {new Date(inventory.scannedAt).toLocaleString()} from{' '}
          {inventory.scannedPath}
        </p>
      )}
    </section>
  );
}
