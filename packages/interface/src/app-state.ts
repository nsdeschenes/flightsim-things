import {createContext, useContext} from 'react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {revalidateLogic, useForm, useStore} from '@tanstack/react-form';
import {desktopQueries} from './queries';

type KeyActivity =
  | {kind: 'idle' | 'saving' | 'removing' | 'saved' | 'removed'}
  | {kind: 'error'; message: string};

export function useAppState() {
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
  const health = useQuery(desktopQueries.health);
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
  const keyBusy = keyMutation.isPending;
  const keyActivity: KeyActivity = keyMutation.isPending
    ? {kind: keyMutation.variables === 'save' ? 'saving' : 'removing'}
    : keyMutation.isError
      ? {kind: 'error', message: keyMutation.error.message}
      : keyMutation.isSuccess
        ? {kind: keyMutation.variables === 'save' ? 'saved' : 'removed'}
        : savedKey.isError
          ? {kind: 'error', message: 'Could not read the saved API key status.'}
          : {kind: 'idle'};
  const status = !window.desktop
    ? 'Open the desktop app to connect.'
    : health.isError || inventories.isError
      ? 'Desktop connection failed. Restart the app to try again.'
      : health.data && inventories.data
        ? `Runtime ${health.data.status}. Database ${health.data.database}.`
        : 'Connecting to desktop…';
  const library = inventories.data ?? [];

  return {
    apiKey,
    keyForm,
    keyStatus,
    keyActivity,
    resetKeyActivity: keyMutation.reset,
    keyBusy,
    updateKey: keyMutation.mutate,
    status,
    library,
  };
}

export const AppContext = createContext<ReturnType<typeof useAppState> | null>(null);

export function useLibrary() {
  const state = useContext(AppContext);
  if (!state) {
    throw new Error('Missing app state');
  }
  return state;
}
