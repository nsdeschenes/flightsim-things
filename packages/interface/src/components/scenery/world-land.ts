import {feature} from 'topojson-client';
import type {GeometryObject, Topology} from 'topojson-specification';
import land from 'world-atlas/land-110m.json?raw';

const topology = JSON.parse(land) as Topology<{land: GeometryObject}>;
const converted = feature(topology, topology.objects.land);
const landFeature =
  converted.type === 'FeatureCollection' ? converted.features[0]! : converted;

export const worldLand = {...landFeature, properties: {}};
