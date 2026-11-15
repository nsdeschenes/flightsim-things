import React from 'react';
import {createRoot} from 'react-dom/client';
import {defineChart} from '@tanstack/charts';
import {geoShape} from '@tanstack/charts/geo';
import {Chart} from '@tanstack/charts/react';
import {geoEqualEarth} from 'd3-geo';
import {select} from 'd3-selection';
import {zoom, zoomIdentity} from 'd3-zoom';
import world from './land.geojson';

function airportFeatures(records) {
  return [
    ...Map.groupBy(records, record => JSON.stringify(record.position)).values(),
  ].map(group => ({
    type: 'Feature',
    id: group[0].id,
    properties: {
      ids: group.map(record => record.id),
      label: group.map(record => record.code || record.name).join(' / '),
    },
    geometry: {type: 'Point', coordinates: group[0].position},
  }));
}

export function createSceneryMap(host, onSelect, onCamera, onFocus) {
  const root = createRoot(host);
  let records = [];
  let selectedId = null;
  let camera = zoomIdentity;

  function baseProjection() {
    return geoEqualEarth().fitExtent(
      [
        [15, 15],
        [host.clientWidth - 15, host.clientHeight - 15],
      ],
      {type: 'Sphere'}
    );
  }

  function draw() {
    const projection = baseProjection();
    const [x, y] = projection.translate();
    projection
      .translate([x * camera.k + camera.x, y * camera.k + camera.y])
      .scale(projection.scale() * camera.k);
    const definition = defineChart({
      marks: [
        geoShape(world.features, {
          id: 'land',
          projection: () => projection,
          fill: '#294459',
          stroke: '#537489',
          strokeWidth: 0.6,
        }),
        geoShape(airportFeatures(records), {
          id: 'airports',
          key: feature => feature.id,
          projection: () => projection,
          r: feature => (feature.properties.ids.length > 1 ? 7 : 5),
          fill: feature =>
            feature.properties.ids.includes(selectedId) ? '#ffba76' : '#65dec2',
          stroke: '#e6f5ff',
          strokeWidth: 1,
        }),
      ],
      scales: {x: null, y: null},
      margin: 0,
      maxFocusDistance: 16,
    });
    root.render(
      React.createElement(Chart, {
        definition,
        width: host.clientWidth,
        height: host.clientHeight,
        ariaLabel:
          'Installed airport locations. Use the inventory to select individual installations.',
        onSelect: point => {
          const ids = point?.datum?.properties?.ids;
          if (ids) {
            onSelect(ids[0]);
          }
        },
        onFocusChange: point => onFocus(point?.datum?.properties?.label ?? ''),
      })
    );
  }

  const behavior = zoom()
    .extent(() => [
      [0, 0],
      [host.clientWidth, host.clientHeight],
    ])
    .scaleExtent([1, 15])
    .filter(event => !event.type.startsWith('wheel') && !event.button)
    .on('zoom', event => {
      camera = event.transform;
      draw();
      onCamera({x: camera.x, y: camera.y, zoom: camera.k});
    });
  select(host).call(behavior);

  return {
    update(nextRecords, nextSelectedId) {
      records = nextRecords;
      selectedId = nextSelectedId;
      draw();
    },
    zoom(factor) {
      select(host).call(behavior.scaleBy, factor);
    },
    reset() {
      select(host).call(behavior.transform, zoomIdentity);
    },
    focus(position) {
      const [x, y] = baseProjection()(position);
      const transform = zoomIdentity
        .translate(host.clientWidth / 2, host.clientHeight / 2)
        .scale(6)
        .translate(-x, -y);
      select(host).call(behavior.transform, transform);
    },
    resize() {
      select(host).call(behavior.transform, zoomIdentity);
    },
    destroy() {
      select(host).on('.zoom', null);
      root.unmount();
    },
  };
}
