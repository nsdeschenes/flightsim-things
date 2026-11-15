import {queryOptions} from '@tanstack/react-query';

export const desktopQueries = {
  health: queryOptions({
    queryKey: ['desktop', 'health'],
    queryFn: () => window.desktop!.getRuntimeHealth(),
    enabled: Boolean(window.desktop),
  }),
  library: queryOptions({
    queryKey: ['desktop', 'library'],
    queryFn: () => window.desktop!.getAddonLibrary(),
    enabled: Boolean(window.desktop),
  }),
  keyStatus: queryOptions({
    queryKey: ['desktop', 'openaip-key-status'],
    queryFn: () => window.desktop!.getOpenAipKeyStatus(),
    enabled: Boolean(window.desktop),
  }),
};
