/**
 * The parts of liblouis's emscripten build (asm.js, 32-bit widechars) that
 * `../liblouis.ts` uses. The build predates typed emscripten output.
 */
export interface LiblouisModule {
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: string): void;
  };
  ccall(name: string, returnType: string | null, argTypes: string[], args: unknown[]): any;
  _malloc(size: number): number;
  _free(pointer: number): void;
  setValue(pointer: number, value: number, type: "i8" | "i16" | "i32"): void;
  getValue(pointer: number, type: "i8" | "i16" | "i32"): number;
  stringToUTF32(text: string, pointer: number, maxBytes: number): void;
  HEAPU32: Uint32Array;
}

export function createLiblouis(module?: {
  ENVIRONMENT?: "WEB" | "WORKER" | "NODE" | "SHELL";
  print?: (text: string) => void;
  printErr?: (text: string) => void;
}): LiblouisModule;
