import {setTimeout as delay} from 'node:timers/promises';

type DeepReadonly<Value> = Value extends object
  ? Value extends (...args: readonly never[]) => unknown
    ? Value
    : {readonly [Key in keyof Value]: DeepReadonly<Value[Key]>}
  : Value;
type Session = Readonly<{
  send: (input: string) => void;
  waitFor: (message: string) => Promise<void>;
  output: () => string;
  exited: Promise<number>;
  dispose: () => Promise<void>;
}>;
const terminalColumns = 180;
const terminalRows = 60;
const timeoutMilliseconds = 10_000;
const pollMilliseconds = 10;

function createTerminalSession(
  executable: readonly string[],
  home: string,
  args: readonly string[] = ['tui']
): Session {
  let output = '';
  let cursor = 0;
  const decoder = new TextDecoder();
  const terminal = new Bun.Terminal({
    cols: terminalColumns,
    data(_terminal: unknown, data: DeepReadonly<Uint8Array>): void {
      output += decoder.decode(data);
    },
    rows: terminalRows,
  });
  const child = Bun.spawn([...executable, ...args], {
    cwd: home,
    env: {...process.env, HOME: home, TERM: 'xterm-256color', USERPROFILE: home},
    terminal,
  });

  return {
    async dispose() {
      if (child.exitCode === null) {
        child.kill();
      }

      await child.exited;
      terminal.close();
    },
    exited: child.exited,
    output: () => output,
    send(input: string) {
      cursor = output.length;
      terminal.write(input);
    },
    async waitFor(message: string) {
      const deadline = Date.now() + timeoutMilliseconds;
      while (!output.slice(cursor).includes(message)) {
        if (child.exitCode !== null || Date.now() > deadline) {
          throw new Error(`Missing "${message}". Output ${output}`);
        }

        await delay(pollMilliseconds);
      }

      cursor = output.indexOf(message, cursor) + message.length;
    },
  };
}

export default createTerminalSession;
