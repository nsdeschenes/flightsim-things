import {Option} from 'effect';

type ConfigurationCommand = 'ai' | 'openaip-key' | 'sentry';
type RootCommand = Readonly<{name: string; alias?: string | undefined}>;
type Invocation = Readonly<{
  command: Option.Option<string>;
  sensitiveCommand: Option.Option<'ai' | 'openaip-key'>;
  controlInvocation: boolean;
}>;
type PendingValue = 'none' | 'boolean' | 'value';
type ArgumentScan = Readonly<{
  firstValue: string | null;
  fallbackCommand: ConfigurationCommand | null;
  pendingValue: PendingValue;
  controlInvocation: boolean;
  hasLeadingOption: boolean;
}>;
type BuiltInArgument = Readonly<{pendingValue: PendingValue; present: boolean}>;

const negativeNumber = /^-(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u;
const builtInFlag = /^--(?:help|h|version|v|no-help|no-version)$/u;
const shortBuiltInFlag = /[hv]/u;
const lastShortBuiltInFlag = /[hv]$/u;
const booleanLiterals = new Set([
  'false',
  '0',
  'n',
  'no',
  'off',
  'true',
  '1',
  'y',
  'yes',
  'on',
]);
const firstCharacter = 1;
const missing = Option.getOrNull(Option.none());

function shortBuiltInArgument(flags: string, hasInlineValue: boolean): BuiltInArgument {
  if (hasInlineValue) {
    return {
      pendingValue: 'none',
      present: ['h', 'v', 'help', 'version'].includes(flags),
    };
  }

  let pendingValue: PendingValue = 'none';
  if (lastShortBuiltInFlag.test(flags)) {
    pendingValue = 'boolean';
  }

  return {pendingValue, present: shortBuiltInFlag.test(flags)};
}

function valueAfterFlag(hasInlineValue: boolean, kind: PendingValue): PendingValue {
  if (hasInlineValue) {
    return 'none';
  }

  return kind;
}

function builtInArgument(argument: string): BuiltInArgument {
  const [flag = ''] = argument.split('=');
  const hasInlineValue = argument.includes('=');
  if (flag === '--completions' || (flag === '-completions' && hasInlineValue)) {
    return {pendingValue: valueAfterFlag(hasInlineValue, 'value'), present: true};
  }

  if (builtInFlag.test(flag)) {
    return {
      pendingValue: valueAfterFlag(hasInlineValue, 'boolean'),
      present: true,
    };
  }

  if (!argument.startsWith('--')) {
    return shortBuiltInArgument(flag.slice(firstCharacter), hasInlineValue);
  }

  return {pendingValue: 'none', present: false};
}

function configurationCommand(value: string): ConfigurationCommand | null {
  if (value === 'ai' || value === 'openaip-key' || value === 'sentry') {
    return value;
  }

  return missing;
}

function isValue(argument: string): boolean {
  return !argument.startsWith('-') || argument === '-' || negativeNumber.test(argument);
}

function scanArgument(scan: ArgumentScan, argument: string): ArgumentScan {
  if (
    (scan.pendingValue === 'boolean' && booleanLiterals.has(argument)) ||
    (scan.pendingValue === 'value' && isValue(argument))
  ) {
    return {...scan, pendingValue: 'none'};
  }

  const fallbackCommand = scan.fallbackCommand ?? configurationCommand(argument);
  if (isValue(argument)) {
    return {
      ...scan,
      fallbackCommand,
      firstValue: scan.firstValue ?? argument,
      pendingValue: 'none',
    };
  }

  const {pendingValue, present} = builtInArgument(argument);
  return {
    ...scan,
    controlInvocation: scan.controlInvocation || present,
    fallbackCommand,
    hasLeadingOption: scan.hasLeadingOption || scan.firstValue === missing,
    pendingValue,
  };
}

function scanArguments(args: readonly string[]): ArgumentScan {
  let scan: ArgumentScan = {
    controlInvocation: false,
    fallbackCommand: missing,
    firstValue: missing,
    hasLeadingOption: false,
    pendingValue: 'none',
  };
  for (const argument of args) {
    if (argument === '--') {
      break;
    }

    scan = scanArgument(scan, argument);
  }

  return scan;
}

function classifyInvocation(
  args: readonly string[],
  rootCommands: readonly RootCommand[]
): Invocation {
  const scan = scanArguments(args);
  const rootCommand = Option.fromNullishOr(
    rootCommands.find(
      ({name, alias}: RootCommand) =>
        scan.firstValue !== missing &&
        (name === scan.firstValue || alias === scan.firstValue)
    )
  );
  let command = scan.firstValue;
  let privateCommand = scan.fallbackCommand;
  if (Option.isSome(rootCommand)) {
    command = rootCommand.value.name;
    privateCommand = configurationCommand(command);
  } else if (!scan.hasLeadingOption) {
    privateCommand = missing;
  }

  return {
    command: Option.fromNullishOr(command),
    controlInvocation: scan.controlInvocation,
    sensitiveCommand: Option.fromNullishOr(privateCommand).pipe(
      Option.filter(name => name !== 'sentry')
    ),
  };
}

function isCliControlArgument(argument: string): boolean {
  return argument.startsWith('-') && builtInArgument(argument).present;
}

const invocationClassifier = {classify: classifyInvocation, isCliControlArgument};

export default invocationClassifier;
