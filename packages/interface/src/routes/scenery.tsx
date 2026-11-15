import {createFileRoute} from '@tanstack/react-router';
import {AddonTables} from '../components/addon-tables';

export const Route = createFileRoute('/scenery')({
  component: () => <AddonTables scenery />,
});
