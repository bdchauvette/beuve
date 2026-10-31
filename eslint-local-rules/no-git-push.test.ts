import { createRuleTester } from './create-rule-tester.ts';
import { noGitPush } from './no-git-push.ts';

createRuleTester().run('no-git-push', noGitPush, {
  valid: [
    "const args = ['fetch', '--no-tags', 'origin'];",
    'const items: string[] = []; items.push("a");',
    "const prefix = 'review/';",
    "const ref = 'refs/heads/' + branch;",
    "const remote = 'refs/beuve/pr/1/head';",
    "const word = 'pushed';",
  ],
  invalid: [
    { code: "const args = ['push', 'origin', 'main'];", errors: [{ messageId: 'push' }] },
    { code: 'const command = `send-pack`;', errors: [{ messageId: 'push' }] },
    { code: "const ref = 'refs/heads/review/pr-1';", errors: [{ messageId: 'reviewRef' }] },
    {
      code: 'const ref = `refs/heads/review/${"pr"}-1`;',
      errors: [{ messageId: 'reviewRef' }],
    },
  ],
});
