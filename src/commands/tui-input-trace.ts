import {dlopen, FFIType, ptr} from 'bun:ffi';
import {createWriteStream} from 'node:fs';

const standardInputHandle = -10;
const unavailableConsoleMode = -1;
const delayedProbeMilliseconds = 100;
const emptyConsoleMode = 0;
const firstModeField = 0;
let inputTrace: ReturnType<typeof createWriteStream> | undefined;
type ConsoleState = Readonly<{consoleMode: number; pendingInputEvents: number}>;
let consoleProbe: (() => ConsoleState) | undefined;

function makeConsoleProbe(): () => ConsoleState {
  const library = dlopen('kernel32.dll', {
    GetConsoleMode: {args: [FFIType.u64, FFIType.ptr], returns: FFIType.bool},
    GetNumberOfConsoleInputEvents: {
      args: [FFIType.u64, FFIType.ptr],
      returns: FFIType.bool,
    },
    GetStdHandle: {args: [FFIType.i32], returns: FFIType.u64},
  });
  return function readConsoleState(): ConsoleState {
    const mode = Uint32Array.of(emptyConsoleMode);
    const {
      GetConsoleMode: getConsoleMode,
      GetNumberOfConsoleInputEvents: getInputEvents,
      GetStdHandle: getStdHandle,
    } = library.symbols;
    const handle = getStdHandle(standardInputHandle);
    if (!getConsoleMode(handle, ptr(mode))) {
      return {
        consoleMode: unavailableConsoleMode,
        pendingInputEvents: unavailableConsoleMode,
      };
    }

    const consoleMode = mode.at(firstModeField) ?? unavailableConsoleMode;
    if (!getInputEvents(handle, ptr(mode))) {
      return {consoleMode, pendingInputEvents: unavailableConsoleMode};
    }

    return {
      consoleMode,
      pendingInputEvents: mode.at(firstModeField) ?? unavailableConsoleMode,
    };
  };
}

function traceInput(stage: string, key = ''): void {
  const output = process.env.FLIGHTSIM_TUI_DIAGNOSTICS ?? '';
  if (process.platform !== 'win32' || output === '') {
    return;
  }

  inputTrace ??= createWriteStream(output, {flags: 'a'});
  consoleProbe ??= makeConsoleProbe();
  inputTrace.write(
    `${JSON.stringify({
      ...consoleProbe(),
      dataReaders: process.stdin.listenerCount('data'),
      diagnostic: 'DEBUG-tui-input',
      key,
      paused: process.stdin.isPaused(),
      pid: process.pid,
      raw: process.stdin.isRaw,
      readers: process.stdin.listenerCount('keypress'),
      stage,
      time: performance.now(),
    })}\n`
  );
  if (stage === 'reader-ready') {
    setTimeout(() => {
      traceInput(`${stage}-later`);
    }, delayedProbeMilliseconds).unref();
  }
}

export default traceInput;
