const test = require('node:test');
const assert = require('node:assert');
const { applyPendingRevision, isReleased } = require('../lib/pendingRevisionGate');

const MIN_DEF = { from: 'BORDES ALLOY', to: 'GI ALLOY', mt: 353 };
// MIN as it appears in the ledger: BORDES 247/247, GI ALLOY 353/0.
function minMaps() {
  return {
    obtByProd:   { 'BORDES ALLOY': 247, 'GI ALLOY': 353 },
    utilByProd:  { 'BORDES ALLOY': 247, 'GI ALLOY': 0 },
    availByProd: { 'BORDES ALLOY': 0,   'GI ALLOY': 353 },
  };
}

test('isReleased: empty / TBA is pending, a date is released', () => {
  assert.equal(isReleased(''), false);
  assert.equal(isReleased('   '), false);
  assert.equal(isReleased('TBA'), false);
  assert.equal(isReleased('tba'), false);
  assert.equal(isReleased('2026-07-13'), true);
  assert.equal(isReleased('13/07/2026'), true);
});

test('pending MIN: reverses GI ALLOY back into BORDES, restoring 600', () => {
  const m = minMaps();
  const res = applyPendingRevision(m, MIN_DEF, '');
  assert.equal(res.reversed, true);
  assert.deepEqual(m.obtByProd,   { 'BORDES ALLOY': 600 });
  assert.deepEqual(m.utilByProd,  { 'BORDES ALLOY': 247 });
  assert.deepEqual(m.availByProd, { 'BORDES ALLOY': 353 });
  assert.equal('GI ALLOY' in m.obtByProd, false);
});

test('released MIN: no reversal, split preserved', () => {
  const m = minMaps();
  const res = applyPendingRevision(m, MIN_DEF, '01/07/2026');
  assert.equal(res.reversed, false);
  assert.deepEqual(m.obtByProd, { 'BORDES ALLOY': 247, 'GI ALLOY': 353 });
});

test('no definition: no-op', () => {
  const m = minMaps();
  const res = applyPendingRevision(m, undefined, '');
  assert.equal(res.reversed, false);
  assert.deepEqual(m.obtByProd, { 'BORDES ALLOY': 247, 'GI ALLOY': 353 });
});

test('guard: "to" product missing from maps → skip', () => {
  const m = { obtByProd: { 'BORDES ALLOY': 247 }, utilByProd: { 'BORDES ALLOY': 247 }, availByProd: { 'BORDES ALLOY': 0 } };
  const res = applyPendingRevision(m, MIN_DEF, '');
  assert.equal(res.reversed, false);
  assert.equal(res.reason, 'to-missing');
});

test('guard: "to" already partly utilized → skip (data inconsistent)', () => {
  const m = minMaps();
  m.utilByProd['GI ALLOY'] = 10;
  const res = applyPendingRevision(m, MIN_DEF, '');
  assert.equal(res.reversed, false);
  assert.equal(res.reason, 'to-utilized');
});

test('guard: mt larger than "to" obtained → clamp to obtained', () => {
  const m = minMaps();
  const res = applyPendingRevision(m, { from: 'BORDES ALLOY', to: 'GI ALLOY', mt: 999 }, '');
  assert.equal(res.reversed, true);
  assert.deepEqual(m.obtByProd,   { 'BORDES ALLOY': 600 });
  assert.deepEqual(m.availByProd, { 'BORDES ALLOY': 353 });
  assert.equal('GI ALLOY' in m.obtByProd, false);
});

test('creates "from" bucket if it did not exist', () => {
  const m = { obtByProd: { 'GI ALLOY': 353 }, utilByProd: { 'GI ALLOY': 0 }, availByProd: { 'GI ALLOY': 353 } };
  const res = applyPendingRevision(m, MIN_DEF, '');
  assert.equal(res.reversed, true);
  assert.deepEqual(m.obtByProd,   { 'BORDES ALLOY': 353 });
  assert.deepEqual(m.availByProd, { 'BORDES ALLOY': 353 });
});
