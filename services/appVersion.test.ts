import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundleOf } from './appVersion';

test('the bundle path is read from the published index.html', () => {
  const html = '<script src="https://cdn.tailwindcss.com"></script><script type="module" crossorigin src="/assets/index-BQ4-NQiS.js"></script>';
  assert.equal(bundleOf(html), '/assets/index-BQ4-NQiS.js');
  assert.equal(bundleOf('<script src="/src/index.tsx"></script>'), undefined);
});
