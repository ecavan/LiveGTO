/**
 * Range vs Range analysis using precomputed bucket probabilities and equity matrix.
 */
import strategiesData from '../../data/strategies.json';

const _BUCKET_PROBS = strategiesData.bucket_probs || {};
const _EQUITY_MATRIX = strategiesData.equity_matrix || {};

const _POSITION_SKEW = {
  OOP: { premium: 1.1, nut: 1.05, strong: 1.0, two_pair: 1.0, top_pair: 1.0, overpair: 1.0, mid_pair: 1.0, underpair: 0.95, nut_draw: 1.0, draw: 1.0, weak_made: 0.95, gutshot: 0.95, air: 0.9 },
  IP:  { premium: 0.9, nut: 0.95, strong: 1.0, two_pair: 1.05, top_pair: 1.05, overpair: 1.0, mid_pair: 1.05, underpair: 1.0, nut_draw: 1.05, draw: 1.05, weak_made: 1.0, gutshot: 1.0, air: 1.1 },
};

function _applySkew(baseDist, position) {
  const skew = _POSITION_SKEW[position] || {};
  const adjusted = {};
  for (const [bucket, prob] of Object.entries(baseDist)) {
    adjusted[bucket] = prob * (skew[bucket] || 1.0);
  }
  const total = Object.values(adjusted).reduce((a, b) => a + b, 0);
  if (total > 0) {
    for (const b of Object.keys(adjusted)) adjusted[b] /= total;
  }
  return adjusted;
}

/**
 * Compute range vs range analysis for a given texture and position.
 * @returns {object|null} hero_dist, villain_dist, hero_equity, advantage_label, etc.
 */
export function computeRangeVsRange(texture, heroPosition) {
  if (!(texture in _BUCKET_PROBS) || !(texture in _EQUITY_MATRIX)) return null;

  const baseDist = _BUCKET_PROBS[texture];
  const villainPosition = heroPosition === 'OOP' ? 'IP' : 'OOP';
  const heroDist = _applySkew(baseDist, heroPosition);
  const villainDist = _applySkew(baseDist, villainPosition);
  const equityMatrix = _EQUITY_MATRIX[texture];

  let heroEquity = 0;
  for (const [hb, hp] of Object.entries(heroDist)) {
    for (const [vb, vp] of Object.entries(villainDist)) {
      if (hb in equityMatrix && vb in (equityMatrix[hb] || {})) {
        heroEquity += hp * vp * equityMatrix[hb][vb];
      }
    }
  }

  const diff = heroEquity - 0.5;
  let advantageLabel, advantageColor;
  if (diff > 0.03) {
    advantageLabel = 'Hero has range advantage';
    advantageColor = 'emerald';
  } else if (diff < -0.03) {
    advantageLabel = 'Villain has range advantage';
    advantageColor = 'red';
  } else {
    advantageLabel = 'Ranges are roughly even';
    advantageColor = 'gray';
  }

  return {
    hero_dist: heroDist,
    villain_dist: villainDist,
    hero_equity: Math.round(heroEquity * 1000) / 10,
    villain_equity: Math.round((1 - heroEquity) * 1000) / 10,
    advantage_label: advantageLabel,
    advantage_color: advantageColor,
    advantage_magnitude: Math.round(Math.abs(diff) * 1000) / 10,
  };
}
