import {Button} from '@base-ui/react/button';
import {Field} from '@base-ui/react/field';
import * as stylex from '@stylexjs/stylex';
import {useLibrary} from '../app-state';
import {styles} from '../styles';
import {SimulatorSettings} from '../components/simulator-settings';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/settings')({component: Settings});

function Settings() {
  const {
    apiKey,
    keyForm,
    keyStatus,
    keyActivity,
    resetKeyActivity,
    keyBusy,
    updateKey,
    library,
  } = useLibrary();
  return (
    <>
      <h2 {...stylex.props(styles.subheading)}>Settings</h2>
      <section aria-label="OpenAIP settings" {...stylex.props(styles.section)}>
        <h2 {...stylex.props(styles.subheading)}>OpenAIP</h2>
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
                disabled={keyBusy}
              >
                <Field.Label htmlFor="openaip-key">OpenAIP API key</Field.Label>
                <div {...stylex.props(styles.controls)}>
                  <Field.Control
                    id="openaip-key"
                    type="password"
                    autoComplete="off"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onValueChange={value => {
                      field.handleChange(value);
                      resetKeyActivity();
                    }}
                    disabled={keyBusy}
                    {...stylex.props(styles.input)}
                  />
                  <Button
                    type="submit"
                    disabled={keyBusy || !keyStatus?.available || !apiKey.trim()}
                    {...stylex.props(styles.button)}
                  >
                    {keyActivity.kind === 'saving' ? 'Saving…' : 'Save API key'}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void updateKey('remove')}
                    disabled={keyBusy || !keyStatus?.saved}
                    {...stylex.props(styles.button)}
                  >
                    {keyActivity.kind === 'removing' ? 'Removing…' : 'Remove saved key'}
                  </Button>
                </div>
                <Field.Error match={!field.state.meta.isValid}>
                  {field.state.meta.errors.join(', ')}
                </Field.Error>
              </Field.Root>
            )}
          </keyForm.Field>
        </form>
        <p>
          Enter a key to use for this session, or save it securely on this device. Leave
          the field empty to use the saved key.
        </p>
        {keyStatus && !keyStatus.available && (
          <p>Secure storage is unavailable. Enter a key to use for this session.</p>
        )}
        <div aria-live="polite">
          {keyActivity.kind === 'saved' && <p>API key saved.</p>}
          {keyActivity.kind === 'removed' && <p>Saved API key removed.</p>}
          {keyActivity.kind === 'error' && <p role="alert">{keyActivity.message}</p>}
        </div>
      </section>
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
