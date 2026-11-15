import {NavigationMenu} from '@base-ui/react/navigation-menu';
import * as stylex from '@stylexjs/stylex';
import {Link, Outlet} from '@tanstack/react-router';
import {AppContext, useAppState} from '../app-state';
import {styles} from '../styles';

export function App() {
  const state = useAppState();
  return (
    <AppContext.Provider value={state}>
      <main {...stylex.props(styles.page)}>
        <h1 {...stylex.props(styles.heading)}>Flightsim Things</h1>
        <NavigationMenu.Root aria-label="Main navigation">
          <NavigationMenu.List {...stylex.props(styles.controls, styles.navigationList)}>
            <NavigationMenu.Item>
              <NavigationMenu.Link render={<Link to="/" activeOptions={{exact: true}} />}>
                Home
              </NavigationMenu.Link>
            </NavigationMenu.Item>
            <NavigationMenu.Item>
              <NavigationMenu.Link render={<Link to="/scenery" />}>
                Scenery
              </NavigationMenu.Link>
            </NavigationMenu.Item>
            <NavigationMenu.Item>
              <NavigationMenu.Link render={<Link to="/settings" />}>
                Settings
              </NavigationMenu.Link>
            </NavigationMenu.Item>
          </NavigationMenu.List>
        </NavigationMenu.Root>
        <p role="status">{state.status}</p>
        <Outlet />
      </main>
    </AppContext.Provider>
  );
}
