# Computer opponents

The AI is a deterministic, bounded heuristic search, implemented in `ai.ts` and
connected to the authoritative legal choices and action dispatcher in `turn.ts`.
It uses the same movement, convoy, battle and bond rules as a human player.

It values the player's cash, projected bond scores, affordable interest payments,
government control, factories, neutral territory and useful military positions.
It compares short continuations of rondel actions so a maneuver is evaluated
after moving units, rather than as an empty phase. The opening draft separately
budgets for useful income and opportunities to control countries.

Rondel searches examine at most approximately 650 action previews, spread across
the best economic candidates and a maneuver, with at most 16 continuation steps.
Other decisions examine at most 200 previews. Candidate comparisons keep a fixed
game horizon to avoid rewarding endless delays for hypothetical future income.

Opponent cash is replaced with a conservative estimate before searching.
The AI does not inspect opponents' actual balances or their turn checkpoints.
It currently allows Swiss-bank veto requests; the existing veto rule reopens
the same rondel choice, so repeatedly blocking it would allow an indefinite stall.

Automatic play yields a Continue prompt if its work limit is reached. Tests cover
strategic decisions, privacy, legal complete matches against the previous policy,
and automatic turn handoffs at three- and six-player tables. Match results are
regression evidence for these starting positions, not a rating against humans.

Run the suite with `npm test -w server -- src/rules/ai.test.ts`.
