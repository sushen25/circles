import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest only auto-cleans when `globals` is on, and it is not; without this,
// one test's DOM is still mounted during the next and queries match twice.
afterEach(cleanup);
