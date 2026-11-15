import * as stylex from '@stylexjs/stylex';
import {defineChart} from '@tanstack/charts';
import {geoShape} from '@tanstack/charts/geo';
import {Chart} from '@tanstack/charts/react';
import {geoEqualEarth} from 'd3-geo';
import {dragEnable} from 'd3-drag';
import {select} from 'd3-selection';
import {zoom, zoomIdentity, type ZoomBehavior} from 'd3-zoom';
import type {FeatureCollection, Feature, Point} from 'geojson';
import {useEffect, useMemo, useRef, useState} from 'react';
import {Button} from '../button';
import {Controls} from '../controls';
import {locationGroups, type Installation, type Position} from './model';
import land from './land.json?raw';

type AirportFeature = Feature<Point, {ids: string[]; label: string}>;
const world = JSON.parse(land) as FeatureCollection;

export function SceneryMap({
  records,
  selectedId,
  focusPosition,
  onSelect,
}: {
  records: Installation[];
  selectedId: string | null;
  focusPosition: Position | null;
  onSelect: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const behavior = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const [size, setSize] = useState({width: 0, height: 0});
  const [camera, setCamera] = useState(zoomIdentity);
  const [hover, setHover] = useState('');

  useEffect(() => {
    const element = host.current!;
    let dragWindow: Window | null = null;
    const gesture = zoom<HTMLDivElement, unknown>()
      .extent((): [[number, number], [number, number]] => [
        [0, 0],
        [element.clientWidth, element.clientHeight],
      ])
      .scaleExtent([1, 15])
      .filter(event => !event.type.startsWith('wheel') && !event.button)
      .on('start', event => {
        if (event.sourceEvent?.type === 'mousedown') {
          dragWindow = event.sourceEvent.view;
        }
      })
      .on('end', () => {
        dragWindow = null;
      })
      .on('zoom', event => setCamera(event.transform));
    behavior.current = gesture;
    select(element).call(gesture);
    const observer = new ResizeObserver(() => {
      setSize({width: element.clientWidth, height: element.clientHeight});
      select(element).call(gesture.transform, zoomIdentity);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      select(element).on('.zoom', null);
      if (dragWindow) {
        select(dragWindow).on('mousemove.zoom mouseup.zoom', null);
        dragEnable(dragWindow);
      }
      behavior.current = null;
    };
  }, []);

  const baseProjection = useMemo(
    () =>
      geoEqualEarth().fitExtent(
        [
          [15, 15],
          [Math.max(16, size.width - 15), Math.max(16, size.height - 15)],
        ],
        {type: 'Sphere'}
      ),
    [size]
  );
  const definition = useMemo(() => {
    const projection = geoEqualEarth()
      .scale(baseProjection.scale())
      .translate(baseProjection.translate());
    const [x, y] = projection.translate();
    projection
      .translate([x * camera.k + camera.x, y * camera.k + camera.y])
      .scale(projection.scale() * camera.k);
    const features: AirportFeature[] = locationGroups(records).map(group => ({
      type: 'Feature',
      geometry: {type: 'Point', coordinates: group.position},
      properties: {
        ids: group.records.map(record => record.id),
        label: group.records.map(record => record.name).join(' / '),
      },
    }));
    return defineChart({
      marks: [
        geoShape(world.features, {
          id: 'land',
          projection: () => projection,
          fill: '#294459',
          stroke: '#537489',
          strokeWidth: 0.6,
        }),
        geoShape(features, {
          id: 'airports',
          key: feature => JSON.stringify(feature.geometry.coordinates),
          projection: () => projection,
          r: feature => (feature.properties.ids.length > 1 ? 7 : 5),
          fill: feature =>
            selectedId && feature.properties.ids.includes(selectedId)
              ? '#ffba76'
              : '#65dec2',
          stroke: '#e6f5ff',
          strokeWidth: 1,
        }),
      ],
      scales: {x: null, y: null},
      margin: 0,
      maxFocusDistance: 16,
    });
  }, [records, selectedId, camera, baseProjection]);

  function focus() {
    if (!focusPosition || !host.current || !behavior.current) {
      return;
    }
    const point = baseProjection(focusPosition);
    if (!point) {
      return;
    }
    select(host.current).call(
      behavior.current.transform,
      zoomIdentity
        .translate(size.width / 2, size.height / 2)
        .scale(6)
        .translate(-point[0], -point[1])
    );
  }

  return (
    <section aria-label="Scenery map">
      <Controls>
        <Button
          onClick={() =>
            host.current &&
            behavior.current &&
            select(host.current).call(behavior.current.scaleBy, 1.5)
          }
          aria-label="Zoom in"
        >
          +
        </Button>
        <Button
          onClick={() =>
            host.current &&
            behavior.current &&
            select(host.current).call(behavior.current.scaleBy, 1 / 1.5)
          }
          aria-label="Zoom out"
        >
          −
        </Button>
        <Button
          onClick={() =>
            host.current &&
            behavior.current &&
            select(host.current).call(behavior.current.transform, zoomIdentity)
          }
        >
          World overview
        </Button>
        <Button disabled={!focusPosition} onClick={focus}>
          Focus airport
        </Button>
      </Controls>
      <p>
        Drag to pan. Use the buttons to zoom. Scroll to move the page. Select an
        installation below for keyboard access.
      </p>
      <div
        ref={host}
        {...stylex.props(styles.map)}
        data-testid="scenery-map"
        data-camera={`${camera.x},${camera.y},${camera.k}`}
      >
        {size.width > 0 && (
          <Chart
            definition={definition}
            width={size.width}
            height={size.height}
            ariaLabel="Installed airport locations"
            onSelect={point => {
              const datum = point?.datum;
              if (
                datum &&
                'properties' in datum &&
                datum.properties &&
                'ids' in datum.properties
              ) {
                const ids = datum.properties.ids as string[];
                if (ids[0]) {
                  onSelect(ids[0]);
                }
              }
            }}
            onFocusChange={point => {
              const datum = point?.datum;
              setHover(
                datum &&
                  'properties' in datum &&
                  datum.properties &&
                  'label' in datum.properties
                  ? String(datum.properties.label)
                  : ''
              );
            }}
          />
        )}
      </div>
      <p aria-live="polite">
        {hover ||
          'Bundled world overview. Airport locations only; scenery packages remain in the inventory.'}
      </p>
      <small>
        Land ©{' '}
        <a href="https://www.naturalearthdata.com/about/terms-of-use/">Natural Earth</a>,
        public domain. 110m land geometry, bundled for offline use.
      </small>
    </section>
  );
}
const styles = stylex.create({
  map: {
    width: '100%',
    aspectRatio: '2 / 1',
    minHeight: 240,
    overflow: 'hidden',
    backgroundColor: '#101e2b',
    borderRadius: 8,
    touchAction: 'pan-y',
  },
});
