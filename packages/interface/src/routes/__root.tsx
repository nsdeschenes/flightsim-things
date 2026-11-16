import {NavigationMenu} from '@base-ui/react/navigation-menu';
import * as stylex from '@stylexjs/stylex';
import {createRootRoute, Link, Outlet} from '@tanstack/react-router';
import {useQuery} from '@tanstack/react-query';
import {desktopQueries} from '../queries';

import {colors} from '../styles/colors.stylex';
import {spacing} from '../styles/spacing.stylex';
import {typography} from '../styles/typography.stylex';
import {radii} from '../styles/radii.stylex';
import {controls} from '../styles/controls.stylex';

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
    <div {...stylex.props(styles.page)}>
      <aside {...stylex.props(styles.sidebar)}>
        <div {...stylex.props(styles.brand)}>
          <span aria-hidden="true" {...stylex.props(styles.brandMark)}>
            ✈
          </span>
          <h1 {...stylex.props(styles.heading)}>Flightsim Things</h1>
        </div>
        <NavigationMenu.Root aria-label="Main navigation">
          <NavigationMenu.List {...stylex.props(styles.navigationList)}>
            <NavigationMenu.Item>
              <NavigationMenu.Link
                {...stylex.props(styles.navigationLink)}
                render={<Link to="/" activeOptions={{exact: true}} />}
              >
                Home
              </NavigationMenu.Link>
            </NavigationMenu.Item>
            <NavigationMenu.Item>
              <NavigationMenu.Link
                {...stylex.props(styles.navigationLink)}
                render={<Link to="/scenery" />}
              >
                Scenery
              </NavigationMenu.Link>
            </NavigationMenu.Item>
            <NavigationMenu.Item>
              <NavigationMenu.Link
                {...stylex.props(styles.navigationLink)}
                render={<Link to="/settings" />}
              >
                Settings
              </NavigationMenu.Link>
            </NavigationMenu.Item>
          </NavigationMenu.List>
        </NavigationMenu.Root>
        <p role="status" {...stylex.props(styles.status)}>
          {status}
        </p>
      </aside>
      <main {...stylex.props(styles.workspace)}>
        <div {...stylex.props(styles.content)}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}

const styles = stylex.create({
  page: {
    display: 'grid',
    gridTemplateColumns: {
      default: '224px minmax(0, 1fr)',
      '@media (max-width: 700px)': 'minmax(0, 1fr)',
    },
    minHeight: '100vh',
    color: colors.text,
    backgroundColor: colors.pageBackground,
  },
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.xl,
    padding: spacing.xl,
    backgroundColor: colors.sidebar,
    borderRightWidth: 1,
    borderRightStyle: 'solid',
    borderRightColor: colors.border,
    '@media (max-width: 700px)': {
      padding: spacing.lg,
      gap: spacing.md,
      borderRightWidth: 0,
      borderBottomWidth: 1,
      borderBottomStyle: 'solid',
      borderBottomColor: colors.border,
    },
  },
  brand: {display: 'flex', alignItems: 'center', gap: spacing.md},
  brandMark: {
    display: 'grid',
    placeItems: 'center',
    width: 34,
    height: 34,
    flexShrink: 0,
    backgroundColor: colors.text,
    color: colors.onPrimary,
    borderRadius: radii.panel,
    fontSize: 22,
  },
  heading: {
    fontSize: typography.title,
    fontWeight: typography.bold,
    lineHeight: 1.2,
    letterSpacing: '-0.4px',
  },
  navigationList: {
    display: 'flex',
    flexDirection: {default: 'column', '@media (max-width: 700px)': 'row'},
    flexWrap: 'wrap',
    gap: spacing.sm,
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  navigationLink: {
    display: 'block',
    paddingBlock: spacing.sm,
    paddingInline: spacing.md,
    borderRadius: radii.control,
    fontWeight: typography.medium,
    color: {
      default: colors.textMuted,
      ':hover': colors.text,
      ':is([aria-current="page"])': colors.onPrimary,
    },
    backgroundColor: {
      default: colors.transparent,
      ':hover': colors.surfaceHover,
      ':is([aria-current="page"])': colors.primary,
    },
    outlineColor: colors.focusRing,
    outlineStyle: {default: 'none', ':focus-visible': 'solid'},
    outlineWidth: controls.focusWidth,
    outlineOffset: controls.focusOffset,
    textDecoration: 'none',
  },
  status: {
    marginTop: 'auto',
    paddingTop: spacing.xl,
    fontSize: typography.small,
    color: colors.textMuted,
    overflowWrap: 'anywhere',
    '@media (max-width: 700px)': {paddingTop: 0},
  },
  workspace: {
    minWidth: 0,
    padding: {
      default: spacing.page,
      '@media (max-width: 1000px)': spacing.xl,
      '@media (max-width: 700px)': spacing.lg,
    },
    backgroundColor: colors.workspace,
  },
  content: {maxWidth: 1440, marginInline: 'auto'},
});
