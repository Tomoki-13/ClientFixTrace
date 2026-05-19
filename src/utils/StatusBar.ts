import readline from "readline";

let message = '';
const isTTY = (process.stdout as any).isTTY === true;
const originalLog   = console.log;
const originalError = console.error;
const originalWarn  = console.warn;

function clear(): void {
  if (!isTTY || !message) return;
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
}

function render(): void {
  if (!isTTY || !message) return;
  clear();
  const terminalWidth = (process.stdout as any).columns || 80;
  const truncated = message.length > terminalWidth
    ? message.substring(0, terminalWidth - 3) + '...'
    : message;
  process.stdout.write('\x1b[36m' + truncated + '\x1b[0m');
}

function init(): void {
  if (!isTTY) return;
  const wrap = (fn: any) => (...args: any[]) => { clear(); fn(...args); render(); };
  console.log   = wrap(originalLog);
  console.error = wrap(originalError);
  console.warn  = wrap(originalWarn);
}

function update(msg: string): void {
  message = msg;
  if (isTTY) {
    render();
  } else {
    originalLog(msg);
  }
}

function finish(): void {
  clear();
  message = '';
  console.log   = originalLog;
  console.error = originalError;
  console.warn  = originalWarn;
}

export default { init, update, finish, clear };
