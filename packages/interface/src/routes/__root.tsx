import {NavigationMenu} from '@base-ui/react/navigation-menu';
import * as stylex from '@stylexjs/stylex';
import {createRootRoute, Link, Outlet} from '@tanstack/react-router';
import {useQuery} from '@tanstack/react-query';
import {desktopQueries} from '../queries';

export const Route = createRootRoute({component: App});

function App() {
  const health = useQuery(desktopQueries.health);
  let status = 'Connecting to desktop…';
  if (!window.desktop) {
    status = 'Open the desktop app to connect.';
  } else if (health.isError) {
    status = 'Desktop connection failed. Restart the app to try again.';
  } else if (health.data) {
    status = `Runtime ${health.data.status}. Database ${health.data.database}.`;
  }
  return (
    <main {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.heading)}>Flightsim Things</h1>
      <NavigationMenu.Root aria-label="Main navigation">
        <NavigationMenu.List {...stylex.props(styles.navigationList)}>
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
      <p role="status">{status}</p>
      <Outlet />
    </main>
  );
}

const styles = stylex.create({
  page: {
    minHeight: '100vh',
    padding: 48,
    backgroundColor: '#f8f7f4',
    color: '#242424',
    fontFamily: 'system-ui, sans-serif',
  },
  heading: {fontSize: 32, fontWeight: 600, marginBottom: 16},
  navigationList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    listStyle: 'none',
    padding: 0,
    marginBottom: 0,
  },
});
