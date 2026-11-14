import type {DesktopApi} from '@flightsim-things/contract';

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}
