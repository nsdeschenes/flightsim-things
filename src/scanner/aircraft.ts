import path from 'node:path';

import {Option} from 'effect';

import type PackageSnapshot from './model.ts';

type AircraftObservation = PackageSnapshot['aircraft'][number];
type LiveryObservation = PackageSnapshot['liveries'][number];
type ConfigurationSection = Readonly<{
  name: string;
  values: Readonly<Pick<Map<string, string>, 'get' | 'set'>>;
}>;
type Contents = Readonly<{
  aircraft: readonly AircraftObservation[];
  airports: readonly never[];
  liveries: readonly LiveryObservation[];
}>;
const firstIndex = 0;
const nextIndex = 1;
const missing = Option.getOrNull(Option.none());
const bom = /^\uFEFF/u;
const lineBreak = /\r?\n/u;
const quotes = /^"|"$/gu;
const variationSection = /^fltsim\.\d+$/u;
const liverySections = new Set(['livery', 'variation']);

function text(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return missing;
  }
  return value.trim();
}

function vfsKey(value: string): string {
  return path.posix.normalize(value.replaceAll('\\', '/')).toLowerCase();
}

function uncomment(line: string): string {
  let quoted = false;
  for (let index = firstIndex; index < line.length; index += nextIndex) {
    if (line.at(index) === '"') {
      quoted = !quoted;
    } else if (
      !quoted &&
      (line.at(index) === ';' || line.slice(index).startsWith('//'))
    ) {
      return line.slice(firstIndex, index).trim();
    }
  }
  return line.trim();
}

function addConfigurationLine(
  line: string,
  sections: Readonly<Pick<ConfigurationSection[], 'at' | 'push'>>
): void {
  if (line.startsWith('[') && line.endsWith(']')) {
    sections.push({
      name: line.slice(nextIndex, -nextIndex).trim().toLowerCase(),
      values: new Map(),
    });
  } else if (line !== '') {
    const section = sections.at(-nextIndex);
    const separator = line.indexOf('=');
    if (!section || separator < firstIndex) {
      throw new Error(`Invalid aircraft configuration line: ${line}`);
    }
    section.values.set(
      line.slice(firstIndex, separator).trim().toLowerCase(),
      line
        .slice(separator + nextIndex)
        .trim()
        .replaceAll(quotes, '')
    );
  }
}

function parseConfiguration(contents: string): readonly ConfigurationSection[] {
  const sections: ConfigurationSection[] = [];
  for (const rawLine of contents.replace(bom, '').split(lineBreak)) {
    addConfigurationLine(uncomment(rawLine), sections);
  }
  if (
    !sections.some(
      section =>
        section.name === 'general' ||
        liverySections.has(section.name) ||
        variationSection.test(section.name)
    )
  ) {
    throw new Error(
      'Aircraft configuration requires GENERAL, LIVERY, or FLTSIM sections'
    );
  }
  return sections;
}

function sectionValues(
  sections: readonly ConfigurationSection[],
  name: string
): Readonly<Pick<Map<string, string>, 'get' | 'set'>> {
  const section = sections.find(candidate => candidate.name === name);
  if (section) {
    return section.values;
  }
  return new Map();
}

function aircraftObservation(
  container: string,
  sections: readonly ConfigurationSection[]
): AircraftObservation {
  const general = sectionValues(sections, 'general');
  const first = sectionValues(sections, 'fltsim.0');
  return {
    icaoTypeDesignator: text(general.get('icao_type_designator')),
    manufacturer:
      text(general.get('icao_manufacturer')) ?? text(first.get('ui_manufacturer')),
    model: text(general.get('icao_model')),
    name: text(first.get('ui_type')),
    sourceKey: container,
  };
}

function targetContainer(
  container: string,
  sections: readonly ConfigurationSection[]
): string | null {
  const livery = sections.find(section => liverySections.has(section.name));
  if (!livery) {
    return container;
  }
  const base = text(livery.values.get('base_container'));
  if (base === missing) {
    return missing;
  }
  const target = vfsKey(path.posix.join(container, base.replaceAll('\\', '/')));
  if (!target.startsWith('simobjects/airplanes/')) {
    throw new Error(`Invalid virtual aircraft container: ${base}`);
  }
  return target;
}

function liveryObservation(
  relative: string,
  section: ConfigurationSection,
  targetAircraftKey: string | null
): LiveryObservation {
  const {values} = section;
  let airlineCode = text(values.get('icao_airline'));
  if (airlineCode !== missing) {
    airlineCode = airlineCode.toUpperCase();
  }
  return {
    airlineCode,
    airlineName: text(values.get('atc_airline')),
    name: text(values.get('ui_variation')) ?? text(values.get('title')),
    registration: text(values.get('atc_id')),
    sourceKey: `${vfsKey(relative)}#${section.name}`,
    targetAircraftKey,
  };
}

function readAircraft(relative: string, contents: string): Contents {
  const sections = parseConfiguration(contents);
  const container = vfsKey(path.posix.dirname(relative));
  const variations = sections.filter(section => variationSection.test(section.name));
  if (new Set(variations.map(section => section.name)).size !== variations.length) {
    throw new Error(`Duplicate FLTSIM section in ${relative}`);
  }
  const aircraft: AircraftObservation[] = [];
  if (!sections.some(section => liverySections.has(section.name))) {
    aircraft.push(aircraftObservation(container, sections));
  }
  const target = targetContainer(container, sections);
  return {
    aircraft,
    airports: [],
    liveries: variations.map(section => liveryObservation(relative, section, target)),
  };
}

function commonOverrideValue(
  sections: readonly ConfigurationSection[],
  key: string
): string | null {
  const values = new Set(
    sections
      .filter(section => variationSection.test(section.name))
      .map(section => text(section.values.get(key)))
  );
  values.delete(missing);
  if (values.size === nextIndex) {
    return [...values].at(firstIndex) ?? missing;
  }
  return missing;
}

function nativeLiveryObservation(
  relative: string,
  sections: readonly ConfigurationSection[]
): LiveryObservation {
  let airlineCode = commonOverrideValue(sections, 'icao_airline');
  if (airlineCode !== missing) {
    airlineCode = airlineCode.toUpperCase();
  }
  return {
    airlineCode,
    airlineName: commonOverrideValue(sections, 'atc_airline'),
    name: text(sectionValues(sections, 'general').get('name')),
    registration: commonOverrideValue(sections, 'atc_id'),
    sourceKey: vfsKey(relative),
    targetAircraftKey: missing,
  };
}

function readLivery(relative: string, contents: string): Contents {
  const sections = parseConfiguration(contents);
  return {
    aircraft: [],
    airports: [],
    liveries: [nativeLiveryObservation(relative, sections)],
  };
}

const configurations = {aircraft: readAircraft, livery: readLivery};
export default configurations;
