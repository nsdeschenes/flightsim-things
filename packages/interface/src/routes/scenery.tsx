import {createFileRoute} from '@tanstack/react-router';
import {SceneryLibrary} from '../components/scenery/scenery-library';

export const Route = createFileRoute('/scenery')({
  component: SceneryLibrary,
});
