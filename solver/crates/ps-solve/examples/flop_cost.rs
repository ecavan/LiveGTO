use postflop_solver::*;
use std::time::Instant;
fn main() {
    let btn = "22+,A2s+,K2s+,Q5s+,J7s+,T7s+,96s+,86s+,75s+,64s+,54s,A2o+,K8o+,Q9o+,J9o+,T9o";
    let bb = "JJ-22,AQs-A6s,A3s-A2s,KQs-K5s,QJs-Q6s,JTs-J7s,T9s-T7s,98s-96s,87s-85s,76s-74s,65s-63s,54s-53s,43s,AQo-A8o,KQo-K9o,QJo-Q9o,JTo-J9o,T9o,98o";
    let flop = std::env::args().nth(1).unwrap_or("Kh9s4d".into());
    let card_config = CardConfig { range: [bb.parse().unwrap(), btn.parse().unwrap()], flop: flop_from_str(&flop).unwrap(), turn: NOT_DEALT, river: NOT_DEALT };
    let a: Vec<String> = std::env::args().collect();
    let ip_flop = BetSizeOptions::try_from((a[2].as_str(), a[3].as_str())).unwrap();
    let oop_flop = BetSizeOptions::try_from(("", a[3].as_str())).unwrap();
    let later = BetSizeOptions::try_from((a[4].as_str(), a[5].as_str())).unwrap();
    let river = BetSizeOptions::try_from((a[6].as_str(), a[7].as_str())).unwrap();
    let alloc = a.get(8).is_some();
    let tree = TreeConfig { initial_state: BoardState::Flop, starting_pot: 55, effective_stack: 975, rake_rate: 0.0, rake_cap: 0.0,
        flop_bet_sizes: [oop_flop, ip_flop], turn_bet_sizes: [later.clone(), later], river_bet_sizes: [river.clone(), river],
        turn_donk_sizes: None, river_donk_sizes: None, add_allin_threshold: 1.5, force_allin_threshold: 0.15, merging_threshold: 0.1 };
    let mut game = PostFlopGame::with_config(card_config, ActionTree::new(tree).unwrap()).unwrap();
    let (m, mc) = game.memory_usage();
    println!("mem {:.2} GB (compressed {:.2} GB)", m as f64 / 1e9, mc as f64 / 1e9);
    if !alloc { return; }
    game.allocate_memory(true);
    let t = Instant::now();
    let e = solve(&mut game, 400, 55.0 * 0.005, false);
    println!("solved in {:.1}s, exploitability {:.3}% pot", t.elapsed().as_secs_f64(), 100.0 * e / 55.0);
}
