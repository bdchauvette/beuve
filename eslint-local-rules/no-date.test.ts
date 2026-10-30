import { createTypedRuleTester } from './testing/create-typed-rule-tester.ts';
import { noDate } from './no-date.ts';

createTypedRuleTester().run('no-date', noDate, {
  valid: [
    'const now = Temporal.Now.instant();',
    'class Date2 {} const d = new Date2();',
    'function f(Date: () => number): number { return Date(); }',
    'const record = { Date: 1 }; const n = record.Date;',
    {
      code: 'declare const value: unknown; const is = value instanceof Date; const iso = Date.prototype.toISOString;',
      options: [{ allowGlobalUses: ['instanceof', 'prototype'] }],
    },
  ],
  invalid: [
    // Only the `Date` annotation is reported: the conversions themselves are allowed.
    {
      code: 'declare const stats: { mtime: Date }; const at = stats.mtime.toTemporalInstant();',
      errors: [{ messageId: 'noDateType' }],
    },
    {
      code: 'declare function lastModified(): Date; const at = lastModified().toTemporalInstant();',
      errors: [{ messageId: 'noDateType' }],
    },
    {
      code: 'declare const date: Date | undefined; const at = date?.toTemporalInstant();',
      errors: [{ messageId: 'noDateType' }],
    },
    {
      code: 'declare const date: Date; const year = date.getUTCFullYear();',
      options: [{ allowMembers: ['getUTCFullYear'] }],
      errors: [{ messageId: 'noDateType' }],
    },
    {
      code: 'const now = new Date();',
      errors: [{ messageId: 'noDateGlobal', data: { usage: 'new Date()' } }],
    },
    {
      code: 'const now = Date.now();',
      errors: [{ messageId: 'noDateGlobal', data: { usage: 'Date.now' } }],
    },
    {
      code: "const at = Date.parse('2026-10-28T12:00:00Z');",
      errors: [{ messageId: 'noDateGlobal', data: { usage: 'Date.parse' } }],
    },
    {
      code: 'const at = Date.UTC(2026, 9, 28);',
      errors: [{ messageId: 'noDateGlobal', data: { usage: 'Date.UTC' } }],
    },
    {
      code: 'declare const value: unknown; const is = value instanceof Date;',
      errors: [{ messageId: 'noDateGlobal', data: { usage: 'instanceof Date' } }],
    },
    {
      code: 'declare const at: Date; const ms = at.getTime();',
      errors: [{ messageId: 'noDateType' }, { messageId: 'noDateValue' }],
    },
    {
      code: 'declare const stats: { mtime: Date }; const ms = +stats.mtime;',
      errors: [{ messageId: 'noDateType' }, { messageId: 'noDateValue' }],
    },
    {
      code: 'declare const a: { at: Date }; declare const b: { at: Date }; const later = a.at > b.at;',
      errors: [
        { messageId: 'noDateType' },
        { messageId: 'noDateType' },
        { messageId: 'noDateValue' },
        { messageId: 'noDateValue' },
      ],
    },
    {
      code: 'declare const stats: { mtime: Date }; const iso = stats.mtime.toISOString();',
      errors: [{ messageId: 'noDateType' }, { messageId: 'noDateValue' }],
    },
    {
      code: 'declare function lastModified(): Date; const at = lastModified();',
      errors: [{ messageId: 'noDateType' }, { messageId: 'noDateValue' }],
    },
    {
      code: 'interface Row { readonly createdAt: Date }',
      errors: [{ messageId: 'noDateType' }],
    },
  ],
});
