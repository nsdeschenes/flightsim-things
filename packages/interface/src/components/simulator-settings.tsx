import {feedbackStyles} from '../styles/feedback';
import {Collapsible} from '@base-ui/react/collapsible';
import {Field} from '@base-ui/react/field';
import * as stylex from '@stylexjs/stylex';
import {colors} from '../styles/colors.stylex';
import {spacing} from '../styles/spacing.stylex';
import {typography} from '../styles/typography.stylex';

import {useMutation, useQueryClient} from '@tanstack/react-query';
import {revalidateLogic, useForm, useStore} from '@tanstack/react-form';
import type {
  EnrichmentSummary,
  ScanWarning,
  SimulatorInventory,
} from '@flightsim-things/contract';
import {desktopQueries} from '../queries';
import {Button} from './button';
import {Controls} from './controls';
import {FieldControl} from './field-control';
import {Heading} from './heading';
import {Section} from './section';

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
    <Section aria-label={label}>
      <Heading>{label}</Heading>
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
              <Field.Label
                {...stylex.props(feedbackStyles.label)}
                htmlFor={`${inventory.simulator}-path`}
              >
                Community folder
              </Field.Label>
              <Controls>
                <FieldControl
                  id={`${inventory.simulator}-path`}
                  {...stylex.props(styles.data)}
                  type="text"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onValueChange={value => {
                    field.handleChange(value);
                    mutation.reset();
                  }}
                  disabled={busy}
                  placeholder="Enter the full Community folder path"
                />
                <Button type="submit" disabled={busy || !path.trim()}>
                  {activity.kind === 'saving' ? 'Saving…' : 'Save path'}
                </Button>
                <Button
                  type="button"
                  onClick={() => mutation.mutate('scanning')}
                  disabled={busy || dirty || !inventory.communityPath}
                >
                  {activity.kind === 'scanning' ? 'Scanning…' : 'Scan addons'}
                </Button>
              </Controls>
              <Field.Error
                {...stylex.props(feedbackStyles.error)}
                match={!field.state.meta.isValid}
              >
                {field.state.meta.errors.join(', ')}
              </Field.Error>
            </Field.Root>
          )}
        </form.Field>
      </form>
      <Controls>
        <Button
          type="button"
          onClick={() => mutation.mutate('enriching')}
          disabled={
            busy || (!apiKey.trim() && !canUseSavedKey) || inventory.airports.length === 0
          }
        >
          {activity.kind === 'enriching' ? 'Enriching…' : 'Enrich airports'}
        </Button>
      </Controls>
      <div aria-live="polite" {...stylex.props(styles.feedback)}>
        {dirty && <p>Save the path before scanning.</p>}
        {activity.kind === 'saved' && (
          <p {...stylex.props(feedbackStyles.success)}>Community folder saved.</p>
        )}
        {activity.kind === 'scanned' && (
          <p>
            Scan complete. Found{' '}
            <span {...stylex.props(styles.data)}>{inventory.addons.length}</span> addons.
            Skipped <span {...stylex.props(styles.data)}>{activity.warnings.length}</span>{' '}
            folders.
          </p>
        )}
        {activity.kind === 'enriched' && (
          <p>
            Updated{' '}
            <span {...stylex.props(styles.data)}>{activity.summary.enriched}</span>{' '}
            airports. Unmatched{' '}
            <span {...stylex.props(styles.data)}>{activity.summary.unmatched}</span>.
            Ambiguous{' '}
            <span {...stylex.props(styles.data)}>{activity.summary.ambiguous}</span>.
            Skipped <span {...stylex.props(styles.data)}>{activity.summary.skipped}</span>
            .
          </p>
        )}
        {activity.kind === 'error' && (
          <p role="alert" {...stylex.props(feedbackStyles.alert)}>
            {activity.message}
          </p>
        )}
        {activity.kind === 'scanned' && activity.warnings.length > 0 && (
          <Collapsible.Root>
            <Collapsible.Trigger render={<Button />}>Skipped folders</Collapsible.Trigger>
            <Collapsible.Panel>
              <ul>
                {activity.warnings.map(warning => (
                  <li key={warning.folderName}>
                    <span {...stylex.props(styles.data)}>{warning.folderName}</span>:{' '}
                    {warning.message}
                  </li>
                ))}
              </ul>
            </Collapsible.Panel>
          </Collapsible.Root>
        )}
      </div>
      {inventory.scannedAt && (
        <p {...stylex.props(styles.scanInfo)}>
          Last scan{' '}
          <span {...stylex.props(styles.data)}>
            {new Date(inventory.scannedAt).toLocaleString()}
          </span>{' '}
          from <span {...stylex.props(styles.data)}>{inventory.scannedPath}</span>
        </p>
      )}
    </Section>
  );
}

const styles = stylex.create({
  data: {fontFamily: typography.mono},
  feedback: {
    marginBlock: spacing.md,
    overflowWrap: 'anywhere',
    color: colors.successText,
  },
  scanInfo: {
    fontSize: typography.small,
    color: colors.textMuted,
    marginBottom: spacing.md,
    overflowWrap: 'anywhere',
  },
});
