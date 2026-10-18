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
  {args: ['community-path', 'set', 'ai'], controlInvocation: false},
  {args: ['community-path', 'set', 'openaip-key'], controlInvocation: false},
  {args: ['community-path', 'set', 'sentry'], controlInvocation: false},
  {args: ['--unknown', 'community-path', 'set', 'ai'], controlInvocation: false},
  {args: ['--help', 'false', 'community-path', 'set', 'ai'], controlInvocation: true},
  {args: ['-v', 'false', 'community-path', 'set', 'ai'], controlInvocation: true},
  {args: ['-hv', 'false', 'community-path', 'set', 'ai'], controlInvocation: true},
  {args: ['--no-help', 'community-path', 'set', 'ai'], controlInvocation: true},
  {args: ['--help=false', 'community-path', 'set', 'ai'], controlInvocation: true},
])(
  'recognized root wins over later credential markers for $args',
  ({
    args,
    controlInvocation,
  }: Readonly<{args: readonly string[]; controlInvocation: boolean}>) => {
    const result = classifyInvocation(args, rootCommands);
    expect(result.command).toEqual(Option.some('community-path'));
    expect(result.sensitiveCommand).toEqual(Option.none());
    expect(result.controlInvocation).toBe(controlInvocation);
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
      controlInvocation: false,
      sensitiveCommand: Option.none(),
    });
  }
);

test('interactive invocation keeps command classification independent of SDK startup', () => {
  expect(classifyInvocation(['tui'], rootCommands)).toEqual({
    command: Option.some('tui'),
    controlInvocation: false,
    sensitiveCommand: Option.none(),
  });
});
