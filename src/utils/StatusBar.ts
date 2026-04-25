import { clear } from "console";
import readline from "readline";
import { WriteStream } from "tty";

class StatusBar {
  static message = '';
  static isTTY = (process.stdout as any).isTTY === true;
  static originalLog = console.log;
  static originalError = console.error;
  static originalWarn = console.warn;

  static init() {
    if (!this.isTTY) return;
    const wrapFunc = (originalFunc: any) => (...args: any[]) => {
      this.clear();
      originalFunc(...args);
      this.render();
    };
    console.log = wrapFunc(this.originalLog);
    console.error = wrapFunc(this.originalError);
    console.warn = wrapFunc(this.originalWarn);
  }

  static update(msg: string) {
    this.message = msg;
    if (this.isTTY) {
      this.render();
    } else {
      this.originalLog(msg);
    }
  }

  static clear() {
    if (!this.isTTY || !this.message) return;
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
  }

  static render() {
    if (!this.isTTY || !this.message) return;
    this.clear();
    const terminalWidth = (process.stdout as any).columns || 80;
    const truncatedMsg = this.message.length > terminalWidth ? this.message.substring(0, terminalWidth - 3) + '...' : this.message;
    process.stdout.write('\x1b[36m' + truncatedMsg + '\x1b[0m');
  }

  static finish() {
    this.clear();
    this.message = '';
    console.log = this.originalLog;
    console.error = this.originalError;
    console.warn = this.originalWarn;
  }
}

export default {
  init: () => StatusBar.init(),
  update: (msg: string) => StatusBar.update(msg),
  finish: () => StatusBar.finish(),
  clear: () => StatusBar.clear(),
};