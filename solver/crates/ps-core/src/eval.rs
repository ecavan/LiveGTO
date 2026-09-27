//! Exact hand-strength evaluator for 3–7 cards.
//!
//! Returns a `u32` where a larger value is a stronger hand: `category << 20 | kickers`, with up to
//! five 4-bit kicker ranks. Straightforward rank-count logic — no lookup tables — because it is
//! used for classification and tests, not in the solver's inner loop.

use crate::{rank, straight_high, suit, Card};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Category {
    HighCard = 0,
    Pair = 1,
    TwoPair = 2,
    Trips = 3,
    Straight = 4,
    Flush = 5,
    FullHouse = 6,
    Quads = 7,
    StraightFlush = 8,
}

impl Category {
    pub fn of(value: u32) -> Category {
        match value >> 20 {
            0 => Category::HighCard,
            1 => Category::Pair,
            2 => Category::TwoPair,
            3 => Category::Trips,
            4 => Category::Straight,
            5 => Category::Flush,
            6 => Category::FullHouse,
            7 => Category::Quads,
            _ => Category::StraightFlush,
        }
    }
}

fn pack(cat: Category, kickers: &[u8]) -> u32 {
    let mut v = (cat as u32) << 20;
    for (i, &k) in kickers.iter().take(5).enumerate() {
        v |= (k as u32) << (16 - 4 * i);
    }
    v
}

pub fn eval(cards: &[Card]) -> u32 {
    let mut counts = [0u8; 13];
    let mut suit_masks = [0u16; 4];
    for &c in cards {
        counts[rank(c) as usize] += 1;
        suit_masks[suit(c) as usize] |= 1 << rank(c);
    }
    let rank_mask = suit_masks.iter().fold(0, |a, &m| a | m);

    // Straight flush / flush
    let mut flush: Option<u16> = None;
    for &m in &suit_masks {
        if m.count_ones() >= 5 {
            if let Some(h) = straight_high(m) {
                return pack(Category::StraightFlush, &[h]);
            }
            flush = Some(m);
        }
    }

    // Ranks grouped by multiplicity, highest rank first.
    let by = |n: u8| -> Vec<u8> {
        (0..13u8)
            .rev()
            .filter(|&r| counts[r as usize] == n)
            .collect()
    };
    let quads = by(4);
    let trips = by(3);
    let pairs = by(2);
    let singles = by(1);
    let desc_except = |skip: &[u8]| -> Vec<u8> {
        (0..13u8)
            .rev()
            .filter(|&r| counts[r as usize] > 0 && !skip.contains(&r))
            .collect()
    };

    if let Some(&q) = quads.first() {
        return pack(
            Category::Quads,
            &[q, *desc_except(&[q]).first().unwrap_or(&0)],
        );
    }
    if let Some(&t) = trips.first() {
        // second trips count as the pair of a full house
        let pair = trips
            .get(1)
            .copied()
            .into_iter()
            .chain(pairs.iter().copied())
            .max();
        if let Some(p) = pair {
            return pack(Category::FullHouse, &[t, p]);
        }
    }
    if let Some(m) = flush {
        let top: Vec<u8> = (0..13u8)
            .rev()
            .filter(|&r| m & (1 << r) != 0)
            .take(5)
            .collect();
        return pack(Category::Flush, &top);
    }
    if let Some(h) = straight_high(rank_mask) {
        return pack(Category::Straight, &[h]);
    }
    if let Some(&t) = trips.first() {
        let mut k = vec![t];
        k.extend(desc_except(&[t]).into_iter().take(2));
        return pack(Category::Trips, &k);
    }
    if pairs.len() >= 2 {
        let (a, b) = (pairs[0], pairs[1]);
        let mut k = vec![a, b];
        k.extend(desc_except(&[a, b]).into_iter().take(1));
        return pack(Category::TwoPair, &k);
    }
    if let Some(&p) = pairs.first() {
        let mut k = vec![p];
        k.extend(desc_except(&[p]).into_iter().take(3));
        return pack(Category::Pair, &k);
    }
    pack(
        Category::HighCard,
        &singles.into_iter().take(5).collect::<Vec<_>>(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cards_from_str;

    fn e(s: &str) -> u32 {
        eval(&cards_from_str(s).unwrap())
    }

    #[test]
    fn categories() {
        assert_eq!(Category::of(e("AhKhQhJhTh")), Category::StraightFlush);
        assert_eq!(Category::of(e("5h4h3h2hAh")), Category::StraightFlush);
        assert_eq!(Category::of(e("9c9d9h9s2c")), Category::Quads);
        assert_eq!(Category::of(e("9c9d9h2s2c")), Category::FullHouse);
        assert_eq!(Category::of(e("9c9d9h2s2c2d")), Category::FullHouse);
        assert_eq!(Category::of(e("Ah9h7h3h2hKs")), Category::Flush);
        assert_eq!(Category::of(e("As2c3d4h5s")), Category::Straight);
        assert_eq!(Category::of(e("9c9d9h2sKc")), Category::Trips);
        assert_eq!(Category::of(e("9c9dKhKs2c")), Category::TwoPair);
        assert_eq!(Category::of(e("9c9dKhQs2c")), Category::Pair);
        assert_eq!(Category::of(e("9c8dKhQs2c")), Category::HighCard);
    }

    #[test]
    fn ordering_and_kickers() {
        assert!(e("AcAsKc5d2d") > e("AhAd9c5s2h"));
        assert!(e("6h5h4h3h2h") > e("5h4h3h2hAh")); // 6-high SF beats wheel SF
        assert!(e("KcKdKh2s2c") > e("QcQdQhAsAc")); // boats by trips rank
        assert_eq!(e("AhKdQcJs9h"), e("AdKcQsJh9c")); // suits irrelevant
        assert!(e("AhKdQcJsTh") > e("AhKdQcJs9h")); // straight > high card
                                                    // three pairs: best two + best kicker
        assert_eq!(e("AhAdKhKd2c2dQs"), e("AsAcKsKcQh3d4d"));
    }
}
