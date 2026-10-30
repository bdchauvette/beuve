declare const brand: unique symbol;

/**
 * A nominal type: `Brand<string, 'SessionId'>` is a string that only values explicitly
 * branded as `SessionId` (via a validating constructor) are assignable to.
 */
export type Brand<T, Name extends string> = T & { readonly [brand]: Name };
