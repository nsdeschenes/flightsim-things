import {Array as Arr, Console, Effect, Option} from 'effect';
import {Prompt} from 'effect/cli';
import type {QuitError} from 'effect/Terminal';

import invocationClassifier from '#invocation';

import flightSearchChoices from './flight-search-choices.ts';

type DeepReadonly<Value> = Value extends object
  ? Value extends (...args: readonly never[]) => unknown
    ? Value
    : {readonly [Key in keyof Value]: DeepReadonly<Value[Key]>}
  : Value;
type Maybe<Value> = DeepReadonly<Option.Option<Value>>;
type Mode = 'departures' | 'arrivals' | 'route' | 'inventory';
type Filters = 'none' | 'aircraft' | 'airline' | 'both';
type Code =
  | Readonly<{kind: 'saved'; id: number; code: string; label: string}>
  | Readonly<{kind: 'manual'; code: string}>;
type OptionalFilters =
  | Readonly<{kind: 'none'}>
  | Readonly<{kind: 'aircraft'; aircraft: Code}>
  | Readonly<{kind: 'airline'; airline: Code}>
  | Readonly<{kind: 'both'; aircraft: Code; airline: Code}>;
type Search =
  | Readonly<{mode: 'departures'; departure: Code; filters: OptionalFilters}>
  | Readonly<{mode: 'arrivals'; destination: Code; filters: OptionalFilters}>
  | Readonly<{
      mode: 'route';
      departure: Code;
      destination: Code;
      filters: OptionalFilters;
    }>
  | Readonly<{mode: 'inventory'; aircraft: Code; airline: Code}>;
type Draft = DeepReadonly<{
  mode: Option.Option<Mode>;
  filters: Filters;
  departure: Maybe<Code>;
  destination: Maybe<Code>;
  aircraft: Maybe<Code>;
  airline: Maybe<Code>;
}>;
type Field = 'departure' | 'destination' | 'aircraft' | 'airline';
type Step = 'mode' | Field | 'filters' | 'review';
type Result =
  | Readonly<{kind: 'Next'; draft: Draft}>
  | Readonly<{kind: 'Back'}>
  | Readonly<{kind: 'Cancel'}>
  | Readonly<{kind: 'Search'; search: Search}>;
type RunStep = (draft: Draft) => Effect.Effect<Result, QuitError, Prompt.Environment>;
type Snapshot = Effect.Success<ReturnType<typeof flightSearchChoices.load>>;
type SavedChoice = Snapshot['pairs'][number]['aircraft'];
type Selection = Readonly<{kind: 'Value'; value: Code}> | Readonly<{kind: 'Back'}>;
type Source = 'keep' | 'saved' | 'manual' | 'back';
type SourceChoice = Readonly<{title: string; value: Source; selected?: boolean}>;
type Prepared =
  | Readonly<{kind: 'Args'; args: readonly string[]}>
  | Readonly<{kind: 'Back'}>;
type PreparationError =
  | Effect.Error<ReturnType<typeof flightSearchChoices.load>>
  | QuitError;
const {Select: select, AutoComplete: autoComplete, String: stringPrompt} = Prompt;
const {map: mapOption} = Option;
const back = {kind: 'Back'} as const;
const firstIndex = 0;
const nextIndex = 1;
const controlCharacters = /\p{Cc}/gu;
const emptyDraft: Draft = {
  aircraft: Option.none<Code>(),
  airline: Option.none<Code>(),
  departure: Option.none<Code>(),
  destination: Option.none<Code>(),
  filters: 'none',
  mode: Option.none<Mode>(),
};
const modeSteps: Readonly<Record<Mode, readonly Step[]>> = {
  arrivals: ['destination', 'filters'],
  departures: ['departure', 'filters'],
  inventory: ['aircraft', 'airline'],
  route: ['departure', 'destination', 'filters'],
};
const filterSteps: Readonly<Record<Filters, readonly Field[]>> = {
  aircraft: ['aircraft'],
  airline: ['airline'],
  both: ['aircraft', 'airline'],
  none: [],
};
const modeTitles: Readonly<Record<Mode, string>> = {
  arrivals: 'Arrivals',
  departures: 'Departures',
  inventory: 'Aircraft + airline',
  route: 'Fixed route',
};
const fieldTitles: Readonly<Record<Field, string>> = {
  aircraft: 'Aircraft',
  airline: 'Airline',
  departure: 'Departure airport',
  destination: 'Destination airport',
};

function sanitize(value: string): string {
  return Bun.stripANSI(value).replaceAll(controlCharacters, ' ');
}

function sameCode(left: Maybe<Code>, right: Code): boolean {
  return (
    Option.isSome(left) &&
    left.value.code === right.code &&
    left.value.kind === right.kind &&
    (left.value.kind === 'manual' ||
      (right.kind === 'saved' && left.value.id === right.id))
  );
}

function activeSteps(draft: Draft): readonly Step[] {
  if (Option.isNone(draft.mode)) {
    return ['mode'];
  }

  let optional: readonly Step[] = [];
  if (draft.mode.value !== 'inventory') {
    optional = filterSteps[draft.filters];
  }

  return ['mode', ...modeSteps[draft.mode.value], ...optional, 'review'];
}

function completeFilters(draft: Draft): Option.Option<OptionalFilters> {
  if (draft.filters === 'none') {
    return Option.some({kind: 'none'});
  }

  if (draft.filters === 'aircraft') {
    return mapOption(
      draft.aircraft,
      (aircraft: Code) => ({aircraft, kind: 'aircraft'}) as const
    );
  }

  if (draft.filters === 'airline') {
    return mapOption(
      draft.airline,
      (airline: Code) => ({airline, kind: 'airline'}) as const
    );
  }

  return Option.gen(function* completeBothFilters() {
    const aircraft = yield* draft.aircraft;
    const airline = yield* draft.airline;
    return {aircraft, airline, kind: 'both'} as const;
  });
}

function completeEndpoint(draft: Draft, filters: OptionalFilters): Option.Option<Search> {
  if (Option.isNone(draft.mode)) {
    return Option.none();
  }

  if (draft.mode.value === 'departures') {
    return mapOption(
      draft.departure,
      (departure: Code) => ({departure, filters, mode: 'departures'}) as const
    );
  }

  if (draft.mode.value === 'arrivals') {
    return mapOption(
      draft.destination,
      (destination: Code) => ({destination, filters, mode: 'arrivals'}) as const
    );
  }

  if (draft.mode.value === 'route') {
    return Option.gen(function* completeRoute() {
      const departure = yield* draft.departure;
      const destination = yield* draft.destination;
      return {departure, destination, filters, mode: 'route'} as const;
    });
  }

  return Option.none();
}

function completeSearch(draft: Draft): Option.Option<Search> {
  if (Option.isSome(draft.mode) && draft.mode.value === 'inventory') {
    return Option.gen(function* completeInventory() {
      const aircraft = yield* draft.aircraft;
      const airline = yield* draft.airline;
      return {aircraft, airline, mode: 'inventory'} as const;
    });
  }

  return completeFilters(draft).pipe(
    Option.flatMap(filters => completeEndpoint(draft, filters))
  );
}

function optionalFields(filters: OptionalFilters): readonly (readonly [Field, Code])[] {
  const fields: (readonly [Field, Code])[] = [];
  if (filters.kind === 'aircraft' || filters.kind === 'both') {
    fields.push(['aircraft', filters.aircraft]);
  }

  if (filters.kind === 'airline' || filters.kind === 'both') {
    fields.push(['airline', filters.airline]);
  }

  return fields;
}

function searchFields(search: Search): readonly (readonly [Field, Code])[] {
  if (search.mode === 'inventory') {
    return [
      ['aircraft', search.aircraft],
      ['airline', search.airline],
    ];
  }

  const fields: (readonly [Field, Code])[] = [];
  if (search.mode === 'departures' || search.mode === 'route') {
    fields.push(['departure', search.departure]);
  }

  if (search.mode === 'arrivals' || search.mode === 'route') {
    fields.push(['destination', search.destination]);
  }

  return [...fields, ...optionalFields(search.filters)];
}

function serialize(search: Search): readonly string[] {
  const flags = {
    aircraft: '--aircraft',
    airline: '--airline',
    departure: '--dep',
    destination: '--arr',
  };
  return [
    'find-flight',
    ...searchFields(search).flatMap(([field, value]) => [flags[field], value.code]),
  ];
}

function compareChoices(left: SavedChoice, right: SavedChoice): number {
  return (
    left.code.localeCompare(right.code) ||
    left.name.localeCompare(right.name) ||
    left.id - right.id
  );
}

function savedChoices(
  snapshot: Snapshot,
  field: Field,
  aircraft: Maybe<Code>
): readonly SavedChoice[] {
  if (field === 'departure' || field === 'destination') {
    return snapshot.airports
      .map(airport => ({
        ...airport,
        name: `${airport.name} | ${airport.aliases.join(' / ')}`,
      }))
      .toSorted(compareChoices);
  }

  let {pairs} = snapshot;
  if (field === 'airline' && Option.isSome(aircraft)) {
    pairs = pairs.filter(pair => pair.aircraft.code === aircraft.value.code);
  }

  const choices = new Map<number, SavedChoice>();
  for (const pair of pairs) {
    if (pair[field].code !== '') {
      choices.set(pair[field].id, pair[field]);
    }
  }

  return [...choices.values()].toSorted(compareChoices);
}

function sourceChoices(current: Maybe<Code>, hasSaved: boolean): readonly SourceChoice[] {
  const choices: SourceChoice[] = [];
  if (Option.isSome(current)) {
    choices.push({
      selected: true,
      title: sanitize(`Keep current ${current.value.code}`),
      value: 'keep',
    });
  }

  if (hasSaved) {
    choices.push({title: 'Saved records', value: 'saved'});
  }

  return [
    ...choices,
    {title: 'Enter a code', value: 'manual'},
    {title: 'Back', value: 'back'},
  ];
}

function manualCode(
  field: Field
): Effect.Effect<Selection, QuitError, Prompt.Environment> {
  return stringPrompt({message: `${fieldTitles[field]} code (empty goes Back)`}).pipe(
    Effect.map(text => {
      if (text === '') {
        return back;
      }

      let code = text.trim();
      if (!invocationClassifier.isCliControlArgument(code)) {
        code = code.toUpperCase();
      }

      return {kind: 'Value', value: {code, kind: 'manual'}} as const;
    })
  );
}

function savedCode(
  field: Field,
  current: Maybe<Code>,
  choices: readonly SavedChoice[]
): Effect.Effect<Selection, QuitError, Prompt.Environment> {
  return autoComplete<Selection>({
    choices: [
      ...choices.map(choice => ({
        description: sanitize(choice.provenance),
        selected:
          Option.isSome(current) &&
          current.value.kind === 'saved' &&
          current.value.id === choice.id &&
          current.value.code === choice.code,
        title: sanitize(`[ID ${choice.id}] ${choice.name} | ${choice.code}`),
        value: {
          kind: 'Value',
          value: {code: choice.code, id: choice.id, kind: 'saved', label: choice.name},
        } as const,
      })),
      {title: 'Back', value: back},
    ],
    emptyMessage: 'No matches. Ctrl+U clears the filter to reach Back.',
    message: `Choose ${fieldTitles[field].toLowerCase()}`,
  });
}

function sourceAnswer(
  source: Source,
  field: Field,
  context: Readonly<{current: Maybe<Code>; choices: readonly SavedChoice[]}>
): Effect.Effect<Selection, QuitError, Prompt.Environment> {
  const {current, choices} = context;
  if (source === 'keep' && Option.isSome(current)) {
    return Effect.succeed({kind: 'Value', value: current.value});
  }

  if (source === 'manual') {
    return manualCode(field);
  }

  return savedCode(field, current, choices);
}

function chooseCode(
  field: Field,
  current: Maybe<Code>,
  choices: readonly SavedChoice[]
): Effect.Effect<Selection, QuitError, Prompt.Environment> {
  return Effect.gen(function* chooseFieldCode() {
    if (choices.length === firstIndex) {
      yield* Console.log(
        `No saved ${fieldTitles[field].toLowerCase()} choices match this selection. Enter a code.`
      );
    }

    while (true) {
      const source = yield* select({
        choices: sourceChoices(current, choices.length > firstIndex),
        message: `${fieldTitles[field]} source`,
      });
      if (source === 'back') {
        return back;
      }

      const answer = yield* sourceAnswer(source, field, {choices, current});
      if (answer.kind === 'Value') {
        return answer;
      }
    }
  });
}

function updateField(draft: Draft, field: Field, value: Code): Draft {
  if (sameCode(draft[field], value)) {
    return draft;
  }

  const updated = {...draft, [field]: Option.some(value)};
  if (field === 'aircraft') {
    return {...updated, airline: Option.none<Code>()};
  }

  if (field === 'departure') {
    return {...updated, destination: Option.none<Code>()};
  }

  return updated;
}

function fieldStep(snapshot: Snapshot, field: Field): RunStep {
  return draft =>
    chooseCode(field, draft[field], savedChoices(snapshot, field, draft.aircraft)).pipe(
      Effect.map(answer => {
        if (answer.kind === 'Back') {
          return back;
        }

        return {draft: updateField(draft, field, answer.value), kind: 'Next'};
      })
    );
}

function chooseFilters(
  draft: Draft
): Effect.Effect<Result, QuitError, Prompt.Environment> {
  return select<Filters | 'back'>({
    choices: [
      {selected: draft.filters === 'none', title: 'No filters', value: 'none'},
      {selected: draft.filters === 'aircraft', title: 'Aircraft', value: 'aircraft'},
      {selected: draft.filters === 'airline', title: 'Airline', value: 'airline'},
      {selected: draft.filters === 'both', title: 'Aircraft + airline', value: 'both'},
      {title: 'Back', value: 'back'},
    ],
    message: 'Optional filters',
  }).pipe(
    Effect.map(filters => {
      if (filters === 'back') {
        return back;
      }

      if (filters === draft.filters) {
        return {draft, kind: 'Next'};
      }

      return {
        draft: {
          ...draft,
          aircraft: Option.none<Code>(),
          airline: Option.none<Code>(),
          filters,
        },
        kind: 'Next',
      };
    })
  );
}

function chooseMode(draft: Draft): Effect.Effect<Result, QuitError, Prompt.Environment> {
  return select<Mode | 'back'>({
    choices: [
      ...(['departures', 'arrivals', 'route', 'inventory'] as const).map(mode => ({
        selected: mode === Option.getOrElse(draft.mode, () => 'departures'),
        title: modeTitles[mode],
        value: mode,
      })),
      {title: 'Back', value: 'back'},
    ],
    message: 'Search mode',
  }).pipe(
    Effect.map(mode => {
      if (mode === 'back') {
        return back;
      }

      if (Option.contains(draft.mode, mode)) {
        return {draft, kind: 'Next'};
      }

      return {draft: {...emptyDraft, mode: Option.some(mode)}, kind: 'Next'};
    })
  );
}

function reviewLine(field: Field, value: Code): string {
  let source = 'manual';
  if (value.kind === 'saved') {
    source = `${value.label} [ID ${value.id}]`;
  }

  return sanitize(`${fieldTitles[field]}: ${value.code} | ${source}`);
}

function displayReview(search: Search): Effect.Effect<void> {
  const lines = Effect.forEach(searchFields(search), ([field, value]) =>
    Console.log(reviewLine(field, value))
  );
  return Console.log(`\n${modeTitles[search.mode]}`).pipe(
    Effect.andThen(lines),
    Effect.asVoid
  );
}

function reviewSearch(
  draft: Draft
): Effect.Effect<Result, QuitError, Prompt.Environment> {
  return Effect.gen(function* confirmSearch() {
    const complete = completeSearch(draft);
    if (Option.isNone(complete)) {
      return back;
    }

    yield* displayReview(complete.value);
    const action = yield* select({
      choices: [
        {title: 'Search', value: 'search'},
        {title: 'Back', value: 'back'},
        {title: 'Cancel to menu', value: 'cancel'},
      ],
      message: 'Review search',
    });
    if (action === 'search') {
      return {kind: 'Search', search: complete.value} as const;
    }

    if (action === 'back') {
      return back;
    }

    return {kind: 'Cancel'} as const;
  });
}

function makeSteps(snapshot: Snapshot): Readonly<Record<Step, RunStep>> {
  return {
    aircraft: fieldStep(snapshot, 'aircraft'),
    airline: fieldStep(snapshot, 'airline'),
    departure: fieldStep(snapshot, 'departure'),
    destination: fieldStep(snapshot, 'destination'),
    filters: chooseFilters,
    mode: chooseMode,
    review: reviewSearch,
  };
}

type Navigation = Readonly<{draft: Draft; cursor: number}>;
function advance(
  state: Navigation,
  step: Step,
  result: Extract<Result, {kind: 'Next' | 'Back'}>
): Option.Option<Navigation> {
  if (result.kind === 'Next') {
    return Option.some({
      cursor: activeSteps(result.draft).indexOf(step) + nextIndex,
      draft: result.draft,
    });
  }

  if (state.cursor === firstIndex) {
    return Option.none();
  }

  return Option.some({...state, cursor: state.cursor - nextIndex});
}

function finish(result: Extract<Result, {kind: 'Search' | 'Cancel'}>): Prepared {
  if (result.kind === 'Search') {
    return {args: serialize(result.search), kind: 'Args'};
  }

  return back;
}

function runSteps(
  steps: Readonly<Record<Step, RunStep>>
): Effect.Effect<Prepared, QuitError, Prompt.Environment> {
  return Effect.gen(function* navigateSearch() {
    let state = Option.some<Navigation>({cursor: firstIndex, draft: emptyDraft});
    while (Option.isSome(state)) {
      const step = Arr.get(activeSteps(state.value.draft), state.value.cursor);
      if (Option.isNone(step)) {
        return back;
      }

      const result = yield* steps[step.value](state.value.draft);
      if (result.kind === 'Search' || result.kind === 'Cancel') {
        return finish(result);
      }

      state = advance(state.value, step.value, result);
    }

    return back;
  });
}

function prepare(): Effect.Effect<Prepared, PreparationError, Prompt.Environment> {
  return Console.log(
    'Saved choices reflect the last scan. Manual codes still need saved counterpart airports and linked liveries.'
  ).pipe(
    Effect.andThen(flightSearchChoices.load()),
    Effect.flatMap(snapshot => runSteps(makeSteps(snapshot)))
  );
}

const guidedFlightSearch = {prepare};

export default guidedFlightSearch;
