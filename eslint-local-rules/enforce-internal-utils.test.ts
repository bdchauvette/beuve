import { createRuleTester } from './create-rule-tester.ts';
import { enforceInternalUtils } from './enforce-internal-utils.ts';

createRuleTester().run('enforce-internal-utils', enforceInternalUtils, {
  valid: [
    "import { createLogger } from '#x/log/create-logger.ts';",
    "import path from 'node:path';",
    "import { html } from 'lit';",
    "import lodashy from 'lodashy';",
    { code: "import _ from 'lodash';", options: [{ banned: ['ramda'] }] },
  ],
  invalid: [
    {
      code: "import _ from 'lodash';",
      errors: [{ messageId: 'useInternalUtils', data: { name: 'lodash' } }],
    },
    {
      code: "import get from 'lodash/get';",
      errors: [{ messageId: 'useInternalUtils', data: { name: 'lodash' } }],
    },
    {
      code: "import debounce from 'lodash.debounce';",
      errors: [{ messageId: 'useInternalUtils', data: { name: 'lodash.debounce' } }],
    },
    {
      code: "import { map } from 'ramda';",
      errors: [{ messageId: 'useInternalUtils', data: { name: 'ramda' } }],
    },
    {
      code: "export { chunk } from 'lodash-es';",
      errors: [{ messageId: 'useInternalUtils', data: { name: 'lodash-es' } }],
    },
    {
      code: "const _ = require('underscore');",
      errors: [{ messageId: 'useInternalUtils', data: { name: 'underscore' } }],
    },
    {
      code: "await import('es-toolkit');",
      errors: [{ messageId: 'useInternalUtils', data: { name: 'es-toolkit' } }],
    },
    {
      code: "import x from '@acme/utils/deep';",
      options: [{ banned: ['@acme/*'] }],
      errors: [{ messageId: 'useInternalUtils', data: { name: '@acme/utils' } }],
    },
  ],
});
