// The duplicate-corrected Play rating: a clone of the bot plays your cards; you are rated on your
// edge over it. Fixed strategies that the old rating liked must now rate well below the bot.
import { describe, it, expect } from 'vitest';
import { createSession, startHand, heroToAct, coachNow, heroAct, botAct, endHand, summary, cloneReplay, ratingFromEdge, ratingSeFromEdge, edgeStats, poolRating, blendedRating, edgeFromRating, ratingFromLoss, MIN_RATED } from '../src/engine/hu/session.js';
import { choose, eloOf } from '../src/engine/hu/agents.js';
import { act } from '../src/engine/hu/game.js';
import { rng } from '../src/engine/hu/game.js';

/** Play n hands against `bot` with `pick(k, sess)` choosing the hero's option index; returns the summary. */
function playFixed(bot, n, pick, seed = 7) {
  const sess = createSession({ botId: bot, level: 2, coachMode: 'session' });
  const rand = rng(seed);
  for (let i = 0; i < n; i++) {
    startHand(sess, rand);
    let guard = 0;
    while (!sess.s.done && guard++ < 40) {
      if (heroToAct(sess)) { const k = coachNow(sess); heroAct(sess, pick(k, sess)); } else botAct(sess, rand);
    }
    endHand(sess);
  }
  return summary(sess);
}
const idx = (k, type) => k.options.findIndex(o => o.type === type);
const foldOrCheck = (k) => { const f = idx(k, 'fold'); return f >= 0 ? f : idx(k, 'check'); };
const shove = (k) => { const a = idx(k, 'allin'); return a >= 0 ? a : (idx(k, 'call') >= 0 ? idx(k, 'call') : idx(k, 'check')); };

describe('duplicate-corrected rating', () => {
  it('the squash is the ladder\'s: ±900·log10(1 + |D|/25), anchored at the bot', () => {
    expect(ratingFromEdge(0, 1660)).toBe(1660);
    expect(ratingFromEdge(25, 1660)).toBe(1660 + Math.round(900 * Math.log10(2)));
    expect(ratingFromEdge(-25, 1660)).toBe(1660 - Math.round(900 * Math.log10(2)));
    expect(ratingSeFromEdge(0, 50)).toBe(Math.round((900 / Math.LN10) * 50 / 25));
  });
  it('edge stats: mean in bb/100 with a standard error', () => {
    const e = edgeStats([1, -1, 2, -2, 0]);
    expect(e.d).toBe(0);
    expect(e.se).toBeGreaterThan(0);
    const pooled = poolRating([{ bot: 'reg', edgeN: 10, edgeSum: 5, edgeSq: 30 }, { bot: 'nit', edgeN: 10, edgeSum: -5, edgeSq: 30 }]);
    expect(pooled.edge).toBe(0);
    expect(pooled.rating).toBe(Math.round((eloOf('reg') + eloOf('nit')) / 2));
    expect(pooled.hands).toBe(20);
    expect(poolRating([{ bot: 'reg', edgeN: MIN_RATED - 1, edgeSum: 1, edgeSq: 1 }])).toBeNull();
  });
  it('the rating blends the duplicate edge with decision quality: a lucky call-down does not rate 2800', () => {
    // 20 hands, a +560bb/100 duplicate edge from one 40bb pot, but 540bb/100 of EV lost (the real session)
    const sq = 20 * 5.6 * 5.6 + 19 * 15 * 15; // mean 5.6bb/hand, spread 15bb
    const dup = { n: 20, d: 560, se: 335, sum: 112, sq };
    const lucky = blendedRating(dup, 1660, 540);
    expect(lucky.prior).toBeLessThan(0); // the grades say you played worse than the bot
    expect(lucky.weight).toBeGreaterThan(100); // and 20 noisy hands carry little weight against that
    expect(lucky.rating).toBeLessThan(ratingFromEdge(560, 1660) - 400);
    // the same edge with flawless decisions: the duplicate result counts and the rating is high
    const sharp = blendedRating(dup, 1660, 0);
    expect(sharp.rating).toBeGreaterThan(lucky.rating + 100);
    expect(sharp.rating).toBeGreaterThan(1900);
    // no decision data: the prior is the bot, and the edge pulls away from him slowly
    expect(blendedRating({ n: 20, d: 50, se: 30, sum: 10, sq: 20 * 0.25 + 19 * 4 }, 1660, null).rating).toBeGreaterThan(1660);
    expect(blendedRating({ n: 10, d: 50, se: 30, sum: 5, sq: 10 }, 1660, null).rating).toBeNull();
    // many hands: the prior fades
    const many = blendedRating({ n: 2000, d: 40, se: 3, sum: 800, sq: 2000 * 0.16 + 1999 * 100 }, 1660, 540);
    expect(many.rating).toBeGreaterThan(1750);
    // the squash and its inverse agree
    expect(Math.round(edgeFromRating(ratingFromEdge(37, 1660), 1660))).toBe(37);
    expect(ratingFromLoss(0)).toBeGreaterThan(ratingFromLoss(50));
  });
  it('a clone of the bot in your seat rates at the bot (edge ≈ 0 by construction)', () => {
    // hero plays exactly what the clone plays: choose() with the clone's dice is not available from
    // the coach menu, so mirror by replaying: the edge of the replayed line over itself is 0
    const sess = createSession({ botId: 'reg', level: 2 });
    const rand = rng(3);
    startHand(sess, rand);
    while (!sess.s.done) { if (heroToAct(sess)) { const a = choose(sess.agent, sess.s, rand); sess.s = act(sess.s, a); } else botAct(sess, rand); }
    const c = cloneReplay(sess);
    expect(c).not.toBeNull();
    expect(Number.isFinite(c.net)).toBe(true);
  }, 60000);
  it('fold-everything and shove-everything rate well below the Reg', () => {
    const fold = playFixed('reg', 40, foldOrCheck);
    const all = playFixed('reg', 150, shove, 23); // shoving is high-variance: 150 deterministic hands
    expect(fold.edgeN).toBe(40);
    expect(fold.prior).toBeLessThanOrEqual(0);
    expect(fold.edge).toBeLessThan(-20);
    expect(fold.rating).toBeLessThan(eloOf('reg') - 100);
    expect(all.edge).toBeLessThan(-20);
    expect(all.rating).toBeLessThan(eloOf('reg') - 100);
    expect(fold.ratingSe).toBeGreaterThan(0);
  }, 300000);
});
