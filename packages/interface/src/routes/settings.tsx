import {Field} from '@base-ui/react/field';
import {createFileRoute} from '@tanstack/react-router';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {revalidateLogic, useForm, useStore} from '@tanstack/react-form';
import {Button} from '../components/button';
import {Controls} from '../components/controls';
import {FieldControl} from '../components/field-control';
import {Heading} from '../components/heading';
import {Section} from '../components/section';
import {SimulatorSettings} from '../components/simulator-settings';
import {desktopQueries} from '../queries';

export const Route = createFileRoute('/settings')({component: Settings});

function Settings() {
  const keyForm = useForm({
    defaultValues: {apiKey: ''},
    validationLogic: revalidateLogic(),
    onSubmit: () => {
      if (!keyMutation.isPending && savedKey.data?.available) {
        keyMutation.mutate('save');
      }
    },
  });
  const apiKey = useStore(keyForm.store, state => state.values.apiKey);
  const queryClient = useQueryClient();
  const inventories = useQuery(desktopQueries.library);
  const savedKey = useQuery(desktopQueries.keyStatus);
  const keyMutation = useMutation({
    gcTime: 0,
    mutationFn: (action: 'save' | 'remove') =>
      action === 'save'
        ? window.desktop!.saveOpenAipKey(apiKey)
        : window.desktop!.removeOpenAipKey(),
    onSuccess: async value => {
      await queryClient.cancelQueries({queryKey: desktopQueries.keyStatus.queryKey});
      queryClient.setQueryData(desktopQueries.keyStatus.queryKey, value);
      keyForm.reset();
    },
  });
  const keyStatus = savedKey.data;
  const library = inventories.data ?? [];
  return (
    <>
      <Heading>Settings</Heading>
      <Section aria-label="OpenAIP settings">
        <Heading>OpenAIP</Heading>
        <p>
          {keyStatus?.saved
            ? 'An API key is saved for both simulators.'
            : 'No API key is saved.'}
        </p>
        <form
          noValidate
          onSubmit={event => {
            event.preventDefault();
            void keyForm.handleSubmit();
          }}
        >
          <keyForm.Field
            name="apiKey"
            validators={{
              onDynamic: ({value}) =>
                !value.trim() ? 'Enter an OpenAIP API key.' : undefined,
            }}
          >
            {field => (
              <Field.Root
                name={field.name}
                invalid={!field.state.meta.isValid}
                dirty={field.state.meta.isDirty}
                touched={field.state.meta.isTouched}
                disabled={keyMutation.isPending}
              >
                <Field.Label htmlFor="openaip-key">OpenAIP API key</Field.Label>
                <Controls>
                  <FieldControl
                    id="openaip-key"
                    type="password"
                    autoComplete="off"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onValueChange={value => {
                      field.handleChange(value);
                      keyMutation.reset();
                    }}
                    disabled={keyMutation.isPending}
                  />
                  <Button
                    type="submit"
                    disabled={
                      keyMutation.isPending || !keyStatus?.available || !apiKey.trim()
                    }
                  >
                    {keyMutation.isPending && keyMutation.variables === 'save'
                      ? 'Saving…'
                      : 'Save API key'}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => keyMutation.mutate('remove')}
                    disabled={keyMutation.isPending || !keyStatus?.saved}
                  >
                    {keyMutation.isPending && keyMutation.variables === 'remove'
                      ? 'Removing…'
                      : 'Remove saved key'}
                  </Button>
                </Controls>
                <Field.Error match={!field.state.meta.isValid}>
                  {field.state.meta.errors.join(', ')}
                </Field.Error>
              </Field.Root>
            )}
          </keyForm.Field>
        </form>
        <p>
          Unsaved keys clear when you leave Settings. Leave the field empty to use the key
          saved securely on this device.
        </p>
        {keyStatus && !keyStatus.available && (
          <p>Secure storage is unavailable. Enter a key to use while Settings is open.</p>
        )}
        <div aria-live="polite">
          {keyMutation.isSuccess && keyMutation.variables === 'save' && (
            <p>API key saved.</p>
          )}
          {keyMutation.isSuccess && keyMutation.variables === 'remove' && (
            <p>Saved API key removed.</p>
          )}
          {keyMutation.isError && <p role="alert">{keyMutation.error.message}</p>}
          {keyMutation.isIdle && savedKey.isError && (
            <p role="alert">Could not read the saved API key status.</p>
          )}
        </div>
      </Section>
      {inventories.isError && <p role="alert">Could not load addon library.</p>}
      {library.map(inventory => (
        <SimulatorSettings
          key={inventory.simulator}
          inventory={inventory}
          apiKey={apiKey}
          canUseSavedKey={Boolean(keyStatus?.saved && keyStatus.available)}
        />
      ))}
    </>
  );
}
