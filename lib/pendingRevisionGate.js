/**
 * lib/pendingRevisionGate.js
 *
 * PERTEK Perubahan gate. A company's PERTEK can be revised into a product
 * split (e.g. Wear Plate 600 → Wear Plate 247 + GI Alloy 353). The split is
 * only official once its PERTEK Perubahan release (terbit) date is entered.
 * Until then the dashboard must show the ORIGINAL PERTEK.
 *
 * The ledger (lib/quotaLedger.json) already bakes the split in as "effective".
 * This module REVERSES a not-yet-released split in the per-product maps that
 * server.js applyLedger() derives — moving `mt` from `to` back into `from` —
 * so the original product/quantity is shown. Pure + in-place; no I/O.
 */

// Empty string or "TBA" (any case) means the release date has NOT been entered.
function isReleased(releaseDate) {
  const d = String(releaseDate == null ? '' : releaseDate).trim();
  return d !== '' && !/^tba$/i.test(d);
}

/**
 * @param {{obtByProd:Object,utilByProd:Object,availByProd:Object}} maps mutated in place
 * @param {{from:string,to:string,mt:number}|undefined} def
 * @param {string} releaseDate
 * @returns {{reversed:boolean, reason?:string}}
 */
function applyPendingRevision(maps, def, releaseDate) {
  if (!def) return { reversed: false, reason: 'no-def' };
  if (isReleased(releaseDate)) return { reversed: false, reason: 'released' };

  const { obtByProd, utilByProd, availByProd } = maps;
  const from = def.from, to = def.to;

  // The "to" product must exist and be untouched (fully available) while pending.
  if (!(to in obtByProd)) return { reversed: false, reason: 'to-missing' };
  if ((Number(utilByProd[to]) || 0) > 0) return { reversed: false, reason: 'to-utilized' };

  const toObt = Number(obtByProd[to]) || 0;
  const mt = Math.min(Number(def.mt) || 0, toObt); // clamp: can't move more than exists
  if (mt <= 0) return { reversed: false, reason: 'zero-mt' };

  // Move `mt` from `to` back into `from` (obtained + available; util on `to` is 0).
  obtByProd[from]   = (Number(obtByProd[from])   || 0) + mt;
  availByProd[from] = (Number(availByProd[from]) || 0) + mt;
  if (!(from in utilByProd)) utilByProd[from] = 0;

  obtByProd[to]   = toObt - mt;
  availByProd[to] = (Number(availByProd[to]) || 0) - mt;
  if (obtByProd[to] <= 0) { delete obtByProd[to]; delete utilByProd[to]; delete availByProd[to]; }

  return { reversed: true };
}

module.exports = { applyPendingRevision, isReleased };
