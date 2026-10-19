# Computer opponents

The AI is a deterministic, bounded heuristic search, implemented in `ai.ts` and
connected to the authoritative legal choices and action dispatcher in `turn.ts`.
It uses the same movement, convoy, battle and bond rules as a human player.

Entry into a region with foreign units (including a friendly army's entry or
change of posture) interrupts movement for combat decisions. The active country
can offer peace, but every defending government may demand battle. Movement
resumes only after those responses. Inactive countries cannot start battles
against units that have simply stayed without changing posture. This follows
the included Imperial rulebook, pages 8, 10 and 14; friendly posture itself does
not require border permission when there are no defending units.

Army positioning accounts for the home railway network. Friendly armies abroad
carry a penalty because they earn no flags, block no factories and still cost
upkeep; useful captures, defence and hostile occupation are preferred.

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

Live games use `ai-runner.ts` instead of chaining automatic actions in an HTTP
request. A PostgreSQL due time and row lock reserve each action, which commits
and broadcasts independently, approximately 1.2 seconds apart. The runner also
handles opening bonds, resumes after restart, and stops when a human must act.
The synchronous engine remains available for simulations and rule tests.

Run the suite with `npm test -w server -- src/rules/ai.test.ts`.
