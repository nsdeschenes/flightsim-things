import {expect, test} from 'bun:test';

import {Option} from 'effect';

import invocationClassifier from './invocation.ts';

const {classify: classifyInvocation} = invocationClassifier;

const rootCommands = [
  {alias: 'assistant', name: 'ai'},
  {name: 'openaip-key'},
  {name: 'sentry'},
  {name: 'community-path'},
  {name: 'generate'},
  {name: 'tui'},
];

test.each([
  {args: ['community-path', 'set', 'ai'], skipTelemetry: false},
  {args: ['community-path', 'set', 'openaip-key'], skipTelemetry: false},
  {args: ['community-path', 'set', 'sentry'], skipTelemetry: false},
  {args: ['--unknown', 'community-path', 'set', 'ai'], skipTelemetry: false},
  {args: ['--help', 'false', 'community-path', 'set', 'ai'], skipTelemetry: true},
  {args: ['-v', 'false', 'community-path', 'set', 'ai'], skipTelemetry: true},
  {args: ['-hv', 'false', 'community-path', 'set', 'ai'], skipTelemetry: true},
  {args: ['--no-help', 'community-path', 'set', 'ai'], skipTelemetry: true},
  {args: ['--help=false', 'community-path', 'set', 'ai'], skipTelemetry: true},
])(
  'recognized root wins over later credential markers for $args',
  ({
    args,
    skipTelemetry,
  }: Readonly<{args: readonly string[]; skipTelemetry: boolean}>) => {
    const result = classifyInvocation(args, rootCommands);
    expect(result.command).toEqual(Option.some('community-path'));
    expect(result.sensitiveCommand).toEqual(Option.none());
    expect(result.skipTelemetry).toBe(skipTelemetry);
  }
);

test.each([
  {args: ['--unknown', 'ai', 'get'], command: 'ai'},
  {args: ['--help', 'false', 'ai', 'get'], command: 'ai'},
  {args: ['assistant', 'get'], command: 'ai'},
  {args: ['openaip-key', 'set', 'ai', 'extra'], command: 'openaip-key'},
  {args: ['--unknown', 'openaip-key', 'set', 'ai'], command: 'openaip-key'},
])('sensitive root is canonical for $args', ({args, command}) => {
  const result = classifyInvocation(args, rootCommands);
  expect(result.command).toEqual(Option.some(command));
  expect(result.sensitiveCommand).toEqual(Option.some(command));
  expect(result.skipTelemetry).toBe(true);
});

test.each([
  {args: ['--log-level', 'private-option-key', 'ai', 'get']},
  {args: ['--help=invalid', 'private-option-key', 'ai', 'get']},
  {args: ['--help', 'false', 'private-option-key', 'ai', 'get']},
])(
  'malformed leading options retain conservative credential masking for $args',
  ({args}: Readonly<{args: readonly string[]}>) => {
    const result = classifyInvocation(args, rootCommands);
    expect(result.command).toEqual(Option.some('private-option-key'));
    expect(result.sensitiveCommand).toEqual(Option.some('ai'));
    expect(result.skipTelemetry).toBe(true);
  }
);

const ordinaryInvocations: Readonly<{
  args: readonly string[];
  command?: string;
}>[] = [
  {args: ['unknown', 'ai'], command: 'unknown'},
  {args: ['-', 'ai'], command: '-'},
  {args: ['-3', 'ai'], command: '-3'},
  {args: ['--', 'ai']},
  {args: ['--unknown', '--', 'ai']},
  {args: ['generate'], command: 'generate'},
];

test.each(ordinaryInvocations)(
  'ordinary roots and trailing operands do not trigger masking for $args',
  ({args, command}: Readonly<{args: readonly string[]; command?: string}>) => {
    expect(classifyInvocation(args, rootCommands)).toEqual({
      command: Option.fromNullishOr(command),
      sensitiveCommand: Option.none(),
      skipTelemetry: false,
    });
  }
);

test('interactive parent skips telemetry while ordinary child commands retain classification', () => {
  expect(classifyInvocation(['tui'], rootCommands)).toEqual({
    command: Option.some('tui'),
    sensitiveCommand: Option.none(),
    skipTelemetry: true,
  });
  expect(classifyInvocation(['community-path', 'get'], rootCommands).skipTelemetry).toBe(
    false
  );
  expect(
    classifyInvocation(['openaip-key', 'set', 'private'], rootCommands).skipTelemetry
  ).toBe(true);
});
