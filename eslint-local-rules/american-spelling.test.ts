import { americanSpelling } from './american-spelling.ts';
import { createRuleTester } from './create-rule-tester.ts';

createRuleTester().run('american-spelling', americanSpelling, {
  valid: [
    "const title = 'Show the changed files with their neighbors';",
    'const label = `The color of ${name}`;',
    '// Normalizes the path and centers the sheet.',
    "const status = 'cancelled';",
    "const word = 'emphasis and analysis and a promise to surprise';",
    "const kind = 'specialist, characteristic and finalist';",
    'const neighbour = 1;',
  ],
  invalid: [
    {
      code: "const title = 'Show the changed files with their neighbours';",
      errors: [{ messageId: 'british', data: { british: 'neighbours', american: 'neighbors' } }],
    },
    {
      code: 'const message = `${path} is too large to analyse`;',
      errors: [{ messageId: 'british', data: { british: 'analyse', american: 'analyze' } }],
    },
    {
      code: '// The colour of the dot.',
      errors: [{ messageId: 'british', data: { british: 'colour', american: 'color' } }],
    },
    {
      code: '/** Normalises the path, then labelled and centred. */\nconst a = 1;',
      errors: [
        { messageId: 'british', data: { british: 'Normalises', american: 'normalizes' } },
        { messageId: 'british', data: { british: 'labelled', american: 'labeled' } },
        { messageId: 'british', data: { british: 'centred', american: 'centered' } },
      ],
    },
    {
      code: "const a = 'grey, honour, defence, licence, capitalise, organisation, whilst';",
      errors: [
        { messageId: 'british', data: { british: 'grey', american: 'gray' } },
        { messageId: 'british', data: { british: 'honour', american: 'honor' } },
        { messageId: 'british', data: { british: 'defence', american: 'defense' } },
        { messageId: 'british', data: { british: 'licence', american: 'license' } },
        { messageId: 'british', data: { british: 'capitalise', american: 'capitalize' } },
        { messageId: 'british', data: { british: 'organisation', american: 'organization' } },
        { messageId: 'british', data: { british: 'whilst', american: 'while' } },
      ],
    },
  ],
});
