import process from 'node:process';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Readonly<Record<string, unknown>>;

/** Receives one serialized JSON log line, without a trailing newline. */
export type LogSink = (line: string) => void;

export interface Logger {
  readonly debug: (message: string, fields?: LogFields) => void;
  readonly info: (message: string, fields?: LogFields) => void;
  readonly warn: (message: string, fields?: LogFields) => void;
  readonly error: (message: string, fields?: LogFields) => void;
}

export interface LoggerOptions {
  /** Minimum level to emit. Defaults to `BEUVE_LOG_LEVEL`, then `info`. */
  readonly level?: LogLevel;
  /** Where lines go. Defaults to stderr. */
  readonly sink?: LogSink;
  /** The environment `BEUVE_LOG_LEVEL` is read from. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Creates a structured logger that writes one JSON object per line:
 * `{"time":…,"level":…,"namespace":…,"message":…,…fields}`. Errors in fields are
 * serialized with name, message and stack. Logging never throws.
 */
export function createLogger(namespace: string, options: LoggerOptions = {}): Logger {
  const threshold = rank(
    options.level ?? parseLevel((options.env ?? process.env)['BEUVE_LOG_LEVEL']) ?? 'info',
  );
  const sink = options.sink ?? writeToStderr;

  const emit = (level: LogLevel, message: string, fields: LogFields = {}): void => {
    if (rank(level) < threshold) {
      return;
    }
    const core = {
      time: Temporal.Now.instant().toString({ fractionalSecondDigits: 3 }),
      level,
      namespace,
      message,
    };
    sink(serialize({ ...core, ...fields, ...core }));
  };

  return {
    debug: (message, fields): void => {
      emit('debug', message, fields);
    },
    info: (message, fields): void => {
      emit('info', message, fields);
    },
    warn: (message, fields): void => {
      emit('warn', message, fields);
    },
    error: (message, fields): void => {
      emit('error', message, fields);
    },
  };
}

function rank(level: LogLevel): number {
  switch (level) {
    case 'debug': {
      return 10;
    }
    case 'info': {
      return 20;
    }
    case 'warn': {
      return 30;
    }
    case 'error': {
      return 40;
    }
  }
}

function parseLevel(value: string | undefined): LogLevel | undefined {
  switch (value?.trim().toLowerCase()) {
    case 'debug': {
      return 'debug';
    }
    case 'info': {
      return 'info';
    }
    case 'warn': {
      return 'warn';
    }
    case 'error': {
      return 'error';
    }
    default: {
      return undefined;
    }
  }
}

function writeToStderr(line: string): void {
  process.stderr.write(`${line}\n`);
}

function serialize(record: Readonly<Record<string, unknown>>): string {
  try {
    return JSON.stringify(record, replaceErrors);
  } catch (error: unknown) {
    return JSON.stringify({
      time: record['time'],
      level: record['level'],
      namespace: record['namespace'],
      message: record['message'],
      serializationError: String(error),
    });
  }
}

function replaceErrors(_key: string, value: unknown): unknown {
  if (Error.isError(value)) {
    return { name: value.name, message: value.message, stack: value.stack, cause: value.cause };
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}
