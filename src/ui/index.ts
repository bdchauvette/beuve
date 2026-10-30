import './beuve-app.ts';
import { installTrustedTypesPolicy } from './install-trusted-types-policy.ts';

// Before the first render: the libraries' HTML goes through the default policy (ADR 0077).
installTrustedTypesPolicy();
