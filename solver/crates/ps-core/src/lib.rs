//! Card utilities and a human-level hand classifier.
//!
//! Card encoding matches `postflop-solver`: `card = 4 * rank + suit`, rank 0 = deuce … 12 = ace.
//!
//! The classifier answers the question a live player asks at the table — "what *kind* of hand is
//! this on this board?" — not "what is its exact equity". Profiles (opponent leaks) and the
//! strategy reports are both written in terms of these classes, so they have to be stable,
//! simple and testable rather than clever.

pub mod eval;

pub use eval::{eval, Category};

pub type Card = u8;

#[inline]
pub fn rank(c: Card) -> u8 {
    c >> 2
}

#[inline]
pub fn suit(c: Card) -> u8 {
    c & 3
}

const RANKS: &[u8; 13] = b"23456789TJQKA";
const SUITS: &[u8; 4] = b"cdhs";

pub fn card_from_str(s: &str) -> Option<Card> {
    let b = s.as_bytes();
    if b.len() != 2 {
        return None;
    }
    let r = RANKS.iter().position(|&x| x == b[0].to_ascii_uppercase())? as u8;
    let s = SUITS.iter().position(|&x| x == b[1].to_ascii_lowercase())? as u8;
    Some(4 * r + s)
}

pub fn card_to_string(c: Card) -> String {
    format!(
        "{}{}",
        RANKS[rank(c) as usize] as char,
        SUITS[suit(c) as usize] as char
    )
}

/// Parses a run of cards such as `"Td9d6hQc"`.
pub fn cards_from_str(s: &str) -> Option<Vec<Card>> {
    let s: String = s
        .chars()
        .filter(|c| !c.is_whitespace() && *c != ',')
        .collect();
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len() / 2)
        .map(|i| card_from_str(&s[2 * i..2 * i + 2]))
        .collect()
}

/// What kind of hand hero holds on the current board, in live-player terms.
///
/// Ordered from strongest to weakest made-hand value; `Draw` sits between `Weak` and `Air`
/// because it has no showdown value but real equity.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum HandClass {
    /// Sets, straights, flushes, boats, two pair using both hole cards on an unpaired board.
    Monster,
    /// Overpairs, top pair with a good kicker (T+), trips.
    Strong,
    /// Top pair weak kicker, second pair, pocket pair between the top two board cards.
    Medium,
    /// Third pair or worse, small pocket pairs below the second board card.
    Weak,
    /// No pair of our own, but a flush draw or an open-ender / double gutter (flop & turn only).
    Draw,
    /// Everything else, including hands that only play the board.
    Air,
}

impl HandClass {
    pub const ALL: [HandClass; 6] = [
        HandClass::Monster,
        HandClass::Strong,
        HandClass::Medium,
        HandClass::Weak,
        HandClass::Draw,
        HandClass::Air,
    ];

    pub fn name(self) -> &'static str {
        match self {
            HandClass::Monster => "monster",
            HandClass::Strong => "strong",
            HandClass::Medium => "medium",
            HandClass::Weak => "weak",
            HandClass::Draw => "draw",
            HandClass::Air => "air",
        }
    }

    pub fn index(self) -> usize {
        self as usize
    }
}

/// Classifies `hole` on `board` (3, 4 or 5 cards).
pub fn classify(hole: (Card, Card), board: &[Card]) -> HandClass {
    let (h1, h2) = hole;
    let mut all: Vec<Card> = board.to_vec();
    all.push(h1);
    all.push(h2);

    let v_all = eval(&all);
    let v_board = eval(board);
    let cat = Category::of(v_all);

    // Hero adds nothing to the board (e.g. river four-flush board, hero plays the board).
    if board.len() == 5 && v_all == v_board {
        return HandClass::Air;
    }

    let mut board_ranks: Vec<u8> = board.iter().map(|&c| rank(c)).collect();
    board_ranks.sort_unstable_by(|a, b| b.cmp(a));
    board_ranks.dedup();
    let board_count = |r: u8| board.iter().filter(|&&c| rank(c) == r).count();
    let (r1, r2) = (rank(h1), rank(h2));
    let pocket_pair = r1 == r2;
    let board_paired = board_ranks.len() < board.len();

    // Straight or better that hero participates in.
    if cat >= Category::Straight && v_all > v_board {
        return HandClass::Monster;
    }

    // Sets and trips.
    if cat >= Category::Trips {
        if pocket_pair && board_count(r1) >= 1 {
            return HandClass::Monster; // set (or better)
        }
        let trips_with_hole = [r1, r2].iter().any(|&r| board_count(r) >= 2);
        if trips_with_hole {
            return HandClass::Strong; // trips with one hole card
        }
    }

    // Two pair using both hole cards on an unpaired board.
    if !pocket_pair && !board_paired && board_count(r1) == 1 && board_count(r2) == 1 {
        return HandClass::Monster;
    }

    // Hero's own pair, if any.
    let top = board_ranks[0];
    let second = board_ranks.get(1).copied();
    if pocket_pair {
        if board_count(r1) == 0 {
            if r1 > top {
                return HandClass::Strong; // overpair
            }
            if second.map_or(true, |s| r1 > s) {
                return HandClass::Medium; // between the top two cards
            }
            return HandClass::Weak;
        }
    } else {
        // Pair made with exactly one hole card (the board may also be paired elsewhere).
        let paired: Vec<(u8, u8)> = [(r1, r2), (r2, r1)]
            .into_iter()
            .filter(|&(r, _)| board_count(r) == 1)
            .collect();
        if let Some(&(r, kicker)) = paired.iter().max_by_key(|(r, _)| *r) {
            if r == top {
                return if kicker >= 8 {
                    HandClass::Strong
                } else {
                    HandClass::Medium
                }; // T+ kicker
            }
            if Some(r) == second {
                return HandClass::Medium;
            }
            return HandClass::Weak;
        }
    }

    // No pair of our own: look for draws while cards are still to come.
    if board.len() < 5 && (has_flush_draw(hole, board) || straight_outs(hole, board) >= 2) {
        return HandClass::Draw;
    }
    HandClass::Air
}

/// Four to a flush using at least one hole card.
fn has_flush_draw(hole: (Card, Card), board: &[Card]) -> bool {
    for s in 0..4u8 {
        let on_board = board.iter().filter(|&&c| suit(c) == s).count();
        let in_hand = [hole.0, hole.1].iter().filter(|&&c| suit(c) == s).count();
        if in_hand >= 1 && on_board + in_hand == 4 {
            return true;
        }
    }
    false
}

fn rank_mask(cards: &[Card]) -> u16 {
    cards.iter().fold(0u16, |m, &c| m | (1 << rank(c)))
}

/// Highest straight in a rank mask (bit 0 = deuce), or `None`. Handles the wheel.
pub(crate) fn straight_high(mask: u16) -> Option<u8> {
    let m = (mask as u32) << 1 | ((mask as u32 >> 12) & 1); // ace also plays low at bit 0
    (0..=9u8)
        .rev()
        .find(|&lo| (m >> lo) & 0x1f == 0x1f)
        .map(|lo| lo + 3)
}

/// Number of distinct ranks that would complete a straight hero participates in.
/// 2+ means open-ender or double gutter; 1 means a gutshot.
fn straight_outs(hole: (Card, Card), board: &[Card]) -> usize {
    let board_mask = rank_mask(board);
    let mut all = board.to_vec();
    all.extend([hole.0, hole.1]);
    let all_mask = rank_mask(&all);
    if straight_high(all_mask).is_some() {
        return 0;
    }
    (0..13u8)
        .filter(|&r| all_mask & (1 << r) == 0)
        .filter(|&r| {
            let with = all_mask | (1 << r);
            match straight_high(with) {
                // Hero must participate: the board plus the out alone must not make that straight.
                Some(h) => straight_high(board_mask | (1 << r)) != Some(h),
                None => false,
            }
        })
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(s: &str) -> Vec<Card> {
        cards_from_str(s).unwrap()
    }
    fn cls(hole: &str, board: &str) -> HandClass {
        let h = c(hole);
        classify((h[0], h[1]), &c(board))
    }

    #[test]
    fn parse_roundtrip() {
        for i in 0..52u8 {
            assert_eq!(card_from_str(&card_to_string(i)), Some(i));
        }
        assert_eq!(card_from_str("As"), Some(51));
        assert_eq!(card_from_str("2c"), Some(0));
    }

    #[test]
    fn made_hands() {
        assert_eq!(cls("9h9s", "9dTc2s"), HandClass::Monster); // set
        assert_eq!(cls("JhQd", "9dTc8s"), HandClass::Monster); // straight
        assert_eq!(cls("Th9h", "9dTc2s"), HandClass::Monster); // two pair, both cards
        assert_eq!(cls("AhAd", "9dTc2s"), HandClass::Strong); // overpair
        assert_eq!(cls("AhTd", "9dTc2s"), HandClass::Strong); // TPTK
        assert_eq!(cls("Th5d", "9dTc2s"), HandClass::Medium); // top pair weak kicker
        assert_eq!(cls("9h5d", "9dTc2s"), HandClass::Medium); // second pair
        assert_eq!(cls("2h5d", "9dTc2s"), HandClass::Weak); // bottom pair
        assert_eq!(cls("3h3d", "9dTc4s"), HandClass::Weak); // underpair
        assert_eq!(cls("KhKd", "9d9c2s"), HandClass::Strong); // overpair on paired board
        assert_eq!(cls("9hAd", "9d9c2s"), HandClass::Strong); // trips
    }

    #[test]
    fn draws_and_air() {
        assert_eq!(cls("AhKh", "9h5h2s"), HandClass::Draw); // nut flush draw
        assert_eq!(cls("JdQc", "9hTs2d"), HandClass::Draw); // open-ender
        assert_eq!(cls("AdKc", "9h5s2d"), HandClass::Air); // ace high
        assert_eq!(cls("AdKc", "9h5s2d7c3h"), HandClass::Air);
        assert_eq!(cls("JdQc", "9hTs2d3c4h"), HandClass::Air); // missed draw on river
        assert_eq!(cls("Jd4c", "9hTs2d"), HandClass::Air); // gutshot only -> air
    }

    #[test]
    fn plays_the_board() {
        assert_eq!(cls("2c3d", "AhKhQhJhTh"), HandClass::Air); // royal on board
        assert_eq!(cls("2c3d", "9h8s7d6c5h"), HandClass::Air); // straight on board
        assert_eq!(cls("Jc3d", "9h8s7d6c5h"), HandClass::Air); // wait: J doesn't extend (T needed)
        assert_eq!(cls("Tc3d", "9h8s7d6c5h"), HandClass::Monster); // T-high straight
    }

    #[test]
    fn wheel_straight() {
        assert_eq!(straight_high(rank_mask(&c("Ah2c3d4s5h"))), Some(3));
        assert_eq!(cls("Ah2c", "3d4s5h"), HandClass::Monster);
    }
}
