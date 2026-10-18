import {Option} from 'effect';

type ConfigurationCommand = 'ai' | 'openaip-key' | 'sentry';
type RootCommand = Readonly<{name: string; alias?: string | undefined}>;
type Invocation = Readonly<{
  command: Option.Option<string>;
  sensitiveCommand: Option.Option<'ai' | 'openaip-key'>;
  controlInvocation: boolean;
}>;
type ArgumentScan = Readonly<{
  firstValue: string | null;
  fallbackCommand: ConfigurationCommand | null;
  consumesBoolean: boolean;
  controlInvocation: boolean;
  hasLeadingOption: boolean;
}>;
type BuiltInArgument = Readonly<{consumesBoolean: boolean; present: boolean}>;

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
const nextArgument = 1;
const missing = Option.getOrNull(Option.none());

function shortBuiltInArgument(
  flags: string,
  value: string,
  hasInlineValue: boolean
): BuiltInArgument {
  if (hasInlineValue) {
    return {
      consumesBoolean: false,
      present: ['h', 'v', 'help', 'version'].includes(flags),
    };
  }

  return {
    consumesBoolean: lastShortBuiltInFlag.test(flags) && booleanLiterals.has(value),
    present: shortBuiltInFlag.test(flags),
  };
}

function builtInArgument(argument: string, following: string): BuiltInArgument {
  const [flag = '', inlineValue] = argument.split('=');
  const value = inlineValue ?? following;
  const hasInlineValue = argument.includes('=');
  if (builtInFlag.test(flag)) {
    return {
      consumesBoolean: !hasInlineValue && booleanLiterals.has(value),
      present: true,
    };
  }

  if (!argument.startsWith('--')) {
    return shortBuiltInArgument(flag.slice(firstCharacter), value, hasInlineValue);
  }

  return {consumesBoolean: false, present: false};
}

function configurationCommand(value: string): ConfigurationCommand | null {
  if (value === 'ai' || value === 'openaip-key' || value === 'sentry') {
    return value;
  }

  return missing;
}

function scanArgument(
  scan: ArgumentScan,
  argument: string,
  following: string
): ArgumentScan {
  if (scan.consumesBoolean) {
    return {...scan, consumesBoolean: false};
  }

  const fallbackCommand = scan.fallbackCommand ?? configurationCommand(argument);
  if (!argument.startsWith('-') || argument === '-' || negativeNumber.test(argument)) {
    return {
      ...scan,
      fallbackCommand,
      firstValue: scan.firstValue ?? argument,
    };
  }

  const {consumesBoolean, present} = builtInArgument(argument, following);
  return {
    ...scan,
    consumesBoolean,
    controlInvocation: scan.controlInvocation || present,
    fallbackCommand,
    hasLeadingOption: scan.hasLeadingOption || scan.firstValue === missing,
  };
}

function scanArguments(args: readonly string[]): ArgumentScan {
  let scan: ArgumentScan = {
    consumesBoolean: false,
    controlInvocation: false,
    fallbackCommand: missing,
    firstValue: missing,
    hasLeadingOption: false,
  };
  for (const [index, argument] of args.entries()) {
    if (argument === '--') {
      break;
    }

    scan = scanArgument(scan, argument, args.at(index + nextArgument) ?? '');
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
  return argument.startsWith('-') && builtInArgument(argument, '').present;
}

const invocationClassifier = {classify: classifyInvocation, isCliControlArgument};

export default invocationClassifier;
