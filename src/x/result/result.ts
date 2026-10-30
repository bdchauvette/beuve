/** The success branch of a {@link Result}. */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/** The failure branch of a {@link Result}. */
export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/** A value that is either a success (`Ok<T>`) or an expected failure (`Err<E>`). */
export type Result<T, E> = Ok<T> | Err<E>;
