import type { Brand } from '#x/brand/brand.ts';

import type { RawTraceEvent, TraceRecord, TraceTestId } from './trace-record.ts';
import type { ValueSummary, ValueType } from './value-summary.ts';

/** Bounds on what the recorder keeps and how much of a value it renders. */
export interface TraceRecorderLimits {
  /** Events kept per record (test); later ones are counted as dropped. */
  readonly maxEvents: number;
  /** Events kept per probe and call, so a branch inside a hot loop can't crowd out the rest. */
  readonly maxEventsPerProbe: number;
  /** Nesting rendered inside a value; deeper objects show as `[Object]`. */
  readonly maxDepth: number;
  /** Array items, object keys and collection entries rendered per value. */
  readonly maxItems: number;
  readonly maxStringLength: number;
  readonly maxPreviewLength: number;
}

/** The calls instrumented code makes (see `planInstrumentation`), plus the setup module's hooks. */
/** A call's frame, as `enter` numbered it: only `enter` makes one, so it can't pass for a probe. */
export type TraceFrame = Brand<number, 'TraceFrame'>;

export interface TraceRecorder {
  readonly enter: (probe: number, args: ArrayLike<unknown>) => TraceFrame;
  readonly branch: <T>(frame: TraceFrame, probe: number, value: T) => T;
  readonly value: <T>(frame: TraceFrame, probe: number, value: T) => T;
  readonly mark: (frame: TraceFrame, probe: number) => void;
  readonly caught: (frame: TraceFrame, probe: number, value: unknown) => void;
  readonly loop: (frame: TraceFrame, probe: number) => void;
  readonly iterate: (frame: TraceFrame, probe: number) => void;
  readonly returns: <T>(frame: TraceFrame, probe: number, value: T) => T;
  readonly throws: <T>(frame: TraceFrame, probe: number, value: T) => T;
  readonly unwind: <T>(frame: TraceFrame, error: T) => T;
  readonly exit: (frame: TraceFrame) => void;
  /** Starts attributing events to `test` (`undefined`: outside any test). */
  readonly setTest: (test: TraceTestId | undefined) => void;
  /** The events since the last call, or `undefined` when there were none. */
  readonly take: () => TraceRecord | undefined;
  readonly summarize: (value: unknown) => ValueSummary;
}

interface FrameState {
  returned: { readonly probe: number; readonly value: ValueSummary } | undefined;
  thrown: { readonly probe: number; readonly value: unknown } | undefined;
  unwound: { readonly probe: number | undefined; readonly value: ValueSummary } | undefined;
  readonly loops: Map<number, { iterations: number }>;
  readonly counts: Map<number, number>;
}

interface UtilTypes {
  readonly isProxy: (value: unknown) => boolean;
  readonly isMap: (value: unknown) => boolean;
  readonly isSet: (value: unknown) => boolean;
  readonly isDate: (value: unknown) => boolean;
  readonly isRegExp: (value: unknown) => boolean;
  readonly isNativeError: (value: unknown) => boolean;
  readonly isPromise: (value: unknown) => boolean;
  readonly isTypedArray: (value: unknown) => boolean;
  readonly isAnyArrayBuffer: (value: unknown) => boolean;
}

/**
 * Creates the in-test recorder (ADR 0036). It runs inside the test worker, so it must stay
 * self-contained: the setup module embeds its source text (`String(createTraceRecorder)`), and it
 * may use only language globals, no imports or module-level values.
 *
 * Values are summarized without running program code: properties are read through descriptors
 * (getters show as `[Getter]`), proxies are never looked into, built-ins are read through
 * intrinsics captured when the recorder is created, cycles show as `[Circular]`, and depth, item,
 * string and preview lengths are bounded.
 */
// The recorder's helpers must live inside it, regular expressions included (see above).
/* eslint-disable unicorn/consistent-function-scoping, e18e/prefer-static-regex */
export function createTraceRecorder(limits: TraceRecorderLimits): TraceRecorder {
  type Method = (this: unknown) => unknown;
  const loadUtilTypes = (): UtilTypes | undefined => {
    try {
      const host = globalThis as {
        readonly process?: { readonly getBuiltinModule?: (id: string) => unknown };
      };
      const util = host.process?.getBuiltinModule?.('node:util') as
        { readonly types?: UtilTypes } | undefined;
      return util?.types;
    } catch {
      return undefined;
    }
  };
  const types = loadUtilTypes();
  const getter = (target: object, key: string): Method | undefined => {
    const descriptor: { readonly get?: unknown } | undefined = Object.getOwnPropertyDescriptor(
      target,
      key,
    );
    return descriptor?.get as Method | undefined;
  };
  const method = (target: object, key: string): Method | undefined => {
    const descriptor: { readonly value?: unknown } | undefined = Object.getOwnPropertyDescriptor(
      target,
      key,
    );
    return descriptor?.value as Method | undefined;
  };
  const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
  type Text = ((this: unknown) => string) | undefined;
  const intrinsics = {
    mapSize: getter(Map.prototype, 'size'),
    setSize: getter(Set.prototype, 'size'),
    mapEntries: method(Map.prototype, 'entries') as
      ((this: unknown) => Iterator<[unknown, unknown]>) | undefined,
    setValues: method(Set.prototype, 'values') as
      ((this: unknown) => Iterator<unknown>) | undefined,
    instantFromDate: method(Date.prototype, 'toTemporalInstant') as
      ((this: unknown) => Temporal.Instant) | undefined,
    instantText: method(Temporal.Instant.prototype, 'toString') as
      ((this: unknown, options: Temporal.InstantToStringOptions) => string) | undefined,
    regexpSource: getter(RegExp.prototype, 'source'),
    typedLength: getter(typedArrayPrototype, 'length'),
    bufferLength: getter(ArrayBuffer.prototype, 'byteLength'),
    functionText: method(Function.prototype, 'toString') as Text,
    symbolText: method(Symbol.prototype, 'toString') as Text,
  };
  const call = <T>(method: ((this: unknown) => T) | undefined, target: unknown): T | undefined => {
    if (method === undefined) {
      return undefined;
    }
    return Reflect.apply(method, target, []);
  };
  /** A foreign Date as an ISO instant with milliseconds, through Temporal (ADR 0059). */
  const isoFromDate = (value: unknown): string | undefined => {
    const instant = call(intrinsics.instantFromDate, value);
    if (instant === undefined || intrinsics.instantText === undefined) {
      return undefined;
    }
    return Reflect.apply(intrinsics.instantText, instant, [{ fractionalSecondDigits: 3 }]);
  };
  const isProxy = (value: object): boolean => types?.isProxy(value) ?? false;
  const isKind = (value: object, test: keyof UtilTypes, isFallback: () => boolean): boolean => {
    try {
      if (types === undefined) {
        return isFallback();
      }
      return types[test](value);
    } catch {
      return false;
    }
  };

  const clip = (text: string, length: number): string => {
    if (text.length <= length) {
      return text;
    }
    return `${text.slice(0, Math.max(0, length - 1))}…`;
  };
  const quote = (text: string): string => JSON.stringify(clip(text, limits.maxStringLength));
  const dataValue = (target: object, key: PropertyKey): DataValue | undefined => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (descriptor !== undefined && 'value' in descriptor) {
      return { value: descriptor.value as unknown };
    }
    return undefined;
  };
  const inherited = (target: object, key: string): unknown => {
    let current: object | null = target;
    for (let level = 0; current !== null && level < 16 && !isProxy(current); level += 1) {
      const found = dataValue(current, key);
      if (found !== undefined) {
        return found.value;
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
    return undefined;
  };
  const className = (target: object): string | undefined => {
    const prototype = Object.getPrototypeOf(target) as object | null;
    if (prototype === null) {
      return 'null prototype';
    }
    if (isProxy(prototype)) {
      return undefined;
    }
    const constructor = dataValue(prototype, 'constructor')?.value;
    if (typeof constructor !== 'function' || isProxy(constructor)) {
      return undefined;
    }
    const name = dataValue(constructor, 'name')?.value;
    if (typeof name === 'string' && name !== '' && name !== 'Object') {
      return name;
    }
    return undefined;
  };
  const keyText = (key: PropertyKey): string => {
    if (typeof key === 'symbol') {
      return `[${clip(call(intrinsics.symbolText, key) ?? 'Symbol()', limits.maxStringLength)}]`;
    }
    const text = String(key);
    if (/^[$A-Z_a-z][\w$]*$/u.test(text)) {
      return text;
    }
    return quote(text);
  };

  const classify = (value: unknown): ValueType => {
    if (value === null) {
      return 'null';
    }
    if (typeof value !== 'object') {
      if (typeof value === 'function' && isProxy(value)) {
        return 'proxy';
      }
      return typeof value;
    }
    if (isProxy(value)) {
      return 'proxy';
    }
    if (Array.isArray(value)) {
      return 'array';
    }
    const checks: readonly [keyof UtilTypes, ValueType, () => boolean][] = [
      ['isMap', 'map', (): boolean => value instanceof Map],
      ['isSet', 'set', (): boolean => value instanceof Set],
      ['isDate', 'date', (): boolean => value instanceof Date],
      ['isRegExp', 'regexp', (): boolean => value instanceof RegExp],
      ['isNativeError', 'error', (): boolean => Error.isError(value)],
      ['isPromise', 'promise', (): boolean => value instanceof Promise],
      ['isTypedArray', 'binary', (): boolean => ArrayBuffer.isView(value)],
      ['isAnyArrayBuffer', 'binary', (): boolean => value instanceof ArrayBuffer],
    ];
    const found = checks.find(([test, , fallback]) => isKind(value, test, fallback));
    return found?.[1] ?? 'object';
  };

  // Nested, not top-level: the setup module embeds this function's source, so it can't reach out.
  const deeper = (walk: Walk): Walk => {
    return { depth: walk.depth + 1, seen: walk.seen };
  };
  const render = (value: unknown, walk: Walk): string => {
    const type = classify(value);
    switch (type) {
      case 'undefined':
      case 'null':
      case 'boolean': {
        return String(value);
      }
      case 'number': {
        if (Object.is(value, -0)) {
          return '-0';
        }
        return String(value);
      }
      case 'bigint': {
        return `${String(value)}n`;
      }
      case 'string': {
        return quote(value as string);
      }
      case 'symbol': {
        return clip(call(intrinsics.symbolText, value) ?? 'Symbol()', limits.maxStringLength);
      }
      case 'proxy': {
        return '[Proxy]';
      }
      case 'function': {
        return renderFunction(value as object);
      }
      case 'promise': {
        return 'Promise';
      }
      case 'date': {
        try {
          return isoFromDate(value) ?? 'Date';
        } catch {
          return 'Invalid Date';
        }
      }
      case 'regexp': {
        return `/${clip(String(call(intrinsics.regexpSource, value)), limits.maxStringLength)}/`;
      }
      case 'error': {
        const target = value as object;
        const name = inherited(target, 'name');
        const message = dataValue(target, 'message')?.value;
        let head = 'Error';
        if (typeof name === 'string') {
          head = name;
        }
        if (typeof message === 'string' && message !== '') {
          return `${head}: ${clip(message, limits.maxStringLength)}`;
        }
        return head;
      }
      case 'binary': {
        const target = value as object;
        const isTyped = isKind(target, 'isTypedArray', () => ArrayBuffer.isView(target));
        let length: unknown;
        if (isTyped) {
          length = call(intrinsics.typedLength, target);
        } else {
          length = call(intrinsics.bufferLength, target);
        }
        return `${className(target) ?? 'Buffer'}(${String(length)})`;
      }
      case 'array':
      case 'map':
      case 'set':
      case 'object': {
        return renderContainer(value as object, type, walk);
      }
      case 'unavailable': {
        return '<unavailable>';
      }
    }
  };
  const renderFunction = (target: object): string => {
    const name = dataValue(target, 'name')?.value;
    let label = '';
    if (typeof name === 'string' && name !== '') {
      label = ` ${name}`;
    }
    if (functionSource(target).startsWith('class')) {
      return `[class${label}]`;
    }
    return `[Function${label}]`;
  };
  const functionSource = (target: object): string => {
    try {
      return call(intrinsics.functionText, target) ?? '';
    } catch {
      return '';
    }
  };
  const renderContainer = (
    target: object,
    type: 'array' | 'map' | 'set' | 'object',
    walk: Walk,
  ): string => {
    const { seen } = walk;
    if (seen.has(target)) {
      return '[Circular]';
    }
    const name = className(target);
    const size = containerSize(target, type);
    if (walk.depth >= limits.maxDepth) {
      if (type === 'object') {
        return `[${name ?? 'Object'}]`;
      }
      return `[${name ?? typeName(type)}(${String(size)})]`;
    }
    seen.add(target);
    const body = containerItems(target, type, walk);
    seen.delete(target);
    const more = size - body.length;
    if (more > 0) {
      body.push(`… ${String(more)} more`);
    }
    switch (type) {
      case 'array': {
        if (name === undefined || name === 'Array') {
          return `[${body.join(', ')}]`;
        }
        return `${name}(${String(size)}) [${body.join(', ')}]`;
      }
      case 'map':
      case 'set': {
        const head = `${name ?? typeName(type)}(${String(size)})`;
        if (body.length === 0) {
          return `${head} {}`;
        }
        return `${head} { ${body.join(', ')} }`;
      }
      case 'object': {
        let prefix = '';
        if (name !== undefined) {
          prefix = `${name} `;
        }
        if (body.length === 0) {
          return `${prefix}{}`;
        }
        return `${prefix}{ ${body.join(', ')} }`;
      }
    }
  };
  const typeName = (type: 'array' | 'map' | 'set'): string => {
    return { array: 'Array', map: 'Map', set: 'Set' }[type];
  };
  const containerSize = (target: object, type: 'array' | 'map' | 'set' | 'object'): number => {
    switch (type) {
      case 'array': {
        const length = dataValue(target, 'length')?.value;
        if (typeof length === 'number') {
          return length;
        }
        return 0;
      }
      case 'map': {
        return Number(call(intrinsics.mapSize, target) ?? 0);
      }
      case 'set': {
        return Number(call(intrinsics.setSize, target) ?? 0);
      }
      case 'object': {
        return enumerableKeys(target).length;
      }
    }
  };
  const enumerableKeys = (target: object): PropertyKey[] => {
    return Reflect.ownKeys(target).filter((key) => {
      return Object.getOwnPropertyDescriptor(target, key)?.enumerable === true;
    });
  };
  const property = (target: object, key: PropertyKey, walk: Walk): string => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (descriptor === undefined) {
      return '<empty>';
    }
    if ('value' in descriptor) {
      return render(descriptor.value, deeper(walk));
    }
    if (descriptor.get !== undefined) {
      if (descriptor.set === undefined) {
        return '[Getter]';
      }
      return '[Getter/Setter]';
    }
    return '[Setter]';
  };
  const containerItems = (
    target: object,
    type: 'array' | 'map' | 'set' | 'object',
    walk: Walk,
  ): string[] => {
    const items: string[] = [];
    switch (type) {
      case 'array': {
        const length = Math.min(containerSize(target, type), limits.maxItems);
        for (let index = 0; index < length; index += 1) {
          items.push(property(target, String(index), walk));
        }
        return items;
      }
      case 'map': {
        const iterator = call(intrinsics.mapEntries, target);
        for (let step = iterator?.next(); step !== undefined && step.done !== true;) {
          const [key, entry] = step.value;
          items.push(`${render(key, deeper(walk))} => ${render(entry, deeper(walk))}`);
          step = undefined;
          if (items.length < limits.maxItems) {
            step = iterator?.next();
          }
        }
        return items;
      }
      case 'set': {
        const iterator = call(intrinsics.setValues, target);
        for (let step = iterator?.next(); step !== undefined && step.done !== true;) {
          items.push(render(step.value, deeper(walk)));
          step = undefined;
          if (items.length < limits.maxItems) {
            step = iterator?.next();
          }
        }
        return items;
      }
      case 'object': {
        for (const key of enumerableKeys(target).slice(0, limits.maxItems)) {
          items.push(`${keyText(key)}: ${property(target, key, walk)}`);
        }
        return items;
      }
    }
  };
  const summarize = (value: unknown): ValueSummary => {
    try {
      return {
        type: classify(value),
        preview: clip(render(value, { depth: 0, seen: new Set() }), limits.maxPreviewLength),
      };
    } catch {
      return { type: 'unavailable', preview: '<unavailable>' };
    }
  };

  let seq = 0;
  let nextFrame = 0;
  let test: TraceTestId | undefined;
  let events: RawTraceEvent[] = [];
  let dropped = 0;
  const active: number[] = [];
  const frames = new Map<number, FrameState>();
  const stateOf = (frame: number): FrameState => {
    let state = frames.get(frame);
    if (state === undefined) {
      state = {
        returned: undefined,
        thrown: undefined,
        unwound: undefined,
        loops: new Map(),
        counts: new Map(),
      };
      frames.set(frame, state);
    }
    return state;
  };
  const isAdmitted = (state: FrameState | undefined, probe: number | undefined): boolean => {
    if (state !== undefined && probe !== undefined) {
      const count = (state.counts.get(probe) ?? 0) + 1;
      state.counts.set(probe, count);
      if (count > limits.maxEventsPerProbe) {
        dropped += 1;
        return false;
      }
    }
    if (events.length >= limits.maxEvents) {
      dropped += 1;
      return false;
    }
    return true;
  };
  const nextSeq = (): number => {
    seq += 1;
    return seq;
  };

  return {
    enter: (probe, args): TraceFrame => {
      nextFrame += 1;
      const frame = nextFrame as TraceFrame;
      const parent = active.at(-1);
      active.push(frame);
      stateOf(frame);
      if (isAdmitted(undefined, undefined)) {
        const summaries = Array.from(args, (arg) => summarize(arg));
        events.push({ kind: 'enter', seq: nextSeq(), frame, parent, probe, args: summaries });
      }
      return frame;
    },
    branch: <T>(frame: TraceFrame, probe: number, value: T): T => {
      if (isAdmitted(stateOf(frame), probe)) {
        events.push({ kind: 'branch', seq: nextSeq(), frame, probe, taken: Boolean(value) });
      }
      return value;
    },
    value: <T>(frame: TraceFrame, probe: number, value: T): T => {
      if (isAdmitted(stateOf(frame), probe)) {
        events.push({ kind: 'value', seq: nextSeq(), frame, probe, value: summarize(value) });
      }
      return value;
    },
    mark: (frame, probe): void => {
      if (isAdmitted(stateOf(frame), probe)) {
        events.push({ kind: 'mark', seq: nextSeq(), frame, probe });
      }
    },
    caught: (frame, probe, value): void => {
      const state = stateOf(frame);
      if (state.thrown?.value === value) {
        state.thrown = undefined;
      }
      if (isAdmitted(state, probe)) {
        events.push({ kind: 'caught', seq: nextSeq(), frame, probe, value: summarize(value) });
      }
    },
    loop: (frame, probe): void => {
      const state = stateOf(frame);
      const counter = { kind: 'loop' as const, seq: nextSeq(), frame, probe, iterations: 0 };
      state.loops.set(probe, counter);
      if (isAdmitted(state, probe)) {
        events.push(counter);
      }
    },
    iterate: (frame, probe): void => {
      const counter = stateOf(frame).loops.get(probe);
      if (counter !== undefined) {
        counter.iterations += 1;
      }
    },
    returns: <T>(frame: TraceFrame, probe: number, value: T): T => {
      stateOf(frame).returned = { probe, value: summarize(value) };
      return value;
    },
    throws: <T>(frame: TraceFrame, probe: number, value: T): T => {
      stateOf(frame).thrown = { probe, value };
      return value;
    },
    unwind: <T>(frame: TraceFrame, error: T): T => {
      const state = stateOf(frame);
      let probe: number | undefined;
      if (state.thrown?.value === error) {
        probe = state.thrown.probe;
      }
      state.unwound = { probe, value: summarize(error) };
      return error;
    },
    exit: (frame): void => {
      const state = stateOf(frame);
      frames.delete(frame);
      const position = active.lastIndexOf(frame);
      if (position !== -1) {
        active.splice(position, 1);
      }
      if (!isAdmitted(undefined, undefined)) {
        return;
      }
      if (state.unwound === undefined) {
        const returned = state.returned ?? { probe: undefined, value: summarize(undefined) };
        events.push({ kind: 'return', seq: nextSeq(), frame, ...returned });
      } else {
        events.push({ kind: 'throw', seq: nextSeq(), frame, ...state.unwound });
      }
    },
    setTest: (next): void => {
      test = next;
    },
    take: (): TraceRecord | undefined => {
      if (dropped === 0 && events.length === 0) {
        return undefined;
      }
      const record = { test, events, dropped };
      events = [];
      dropped = 0;
      return record;
    },
    summarize,
  };
}

/** An own data property's value: present, even when the value is `undefined`. */
interface DataValue {
  readonly value: unknown;
}

/** How deep a render is, and the containers it is inside, to cut cycles. */
interface Walk {
  readonly depth: number;
  readonly seen: Set<object>;
}
