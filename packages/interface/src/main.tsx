import * as stylex from '@stylexjs/stylex';
import {StrictMode, useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';

import './reset.css';

function App() {
  const [status, setStatus] = useState(
    window.desktop ? 'Connecting to desktop…' : 'Open the desktop app to connect.'
  );
  useEffect(() => {
    let active = true;
    const desktop = window.desktop;
    if (!desktop) {
      return;
    }
    desktop.getRuntimeHealth().then(
      health => {
        if (active) {
          setStatus(`Runtime ${health.status}. Database ${health.database}.`);
        }
      },
      () => {
        if (active) {
          setStatus('Desktop connection failed.');
        }
      }
    );
    return () => {
      active = false;
    };
  }, []);
  return (
    <main {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.heading)}>Flightsim Things</h1>
      <p role="status">{status}</p>
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
});

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing root element');
}
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
