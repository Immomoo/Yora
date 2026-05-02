import { Buffer } from "buffer";

if (!globalThis.Buffer) {
  globalThis.Buffer = Buffer;
}

const browserGlobal = globalThis as typeof globalThis & {
  global?: typeof globalThis;
};

if (!browserGlobal.global) {
  browserGlobal.global = globalThis;
}

if (!("process" in globalThis)) {
  Object.defineProperty(globalThis, "process", {
    value: {
      browser: true,
      env: {},
    },
    configurable: true,
    writable: true,
  });
}
