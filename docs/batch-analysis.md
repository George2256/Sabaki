# Quick Draw Winrate Graph

Attach an engine that supports `kata-analyze`, `lz-analyze`, or another
configured analysis command. Choose **Engines → Quick Draw Winrate Graph** (F6).
In Chinese, the command is **引擎 → 快速绘制胜率图**. The same button is
available above an existing analysis graph.

The task analyzes the currently selected branch from its root to its end,
including the initial position. It leaves the displayed board position unchanged
and updates the graph as results arrive. The graph header shows completed/total
positions and a Stop button; F6 also stops the task. Completed results remain in
the game. Starting again skips positions with existing finite winrate data.

The task uses the current analysis engine, then the last used analysis engine,
then the first attached engine that supports analysis. It stops ordinary
continuous analysis first. Starting ordinary analysis, generating a move or
starting an engine game stops the batch job. Changing the game, editing its
tree, or switching to a different branch also stops the job; browsing positions
within the same branch is allowed. Stop an engine game before starting a batch
job.

This is a quick overview: each position uses a fresh sample after 100 total
visits or roughly one second, whichever is reached first. If an engine needs
longer to produce its first valid result, the task waits up to 15 seconds.
Silent engines and unsupported positions stop the task with a message and keep
earlier results. Hung synchronization/interruption operations time out and stop
the engine so queued commands cannot contaminate a subsequent run. Use normal
analysis for a more detailed examination of individual moves.

Results use the existing `SBKV` (Black winrate, percent) and `SBKS` (Black score
lead, when available) properties. Save the SGF to retain them. Simplified
Chinese, Traditional Chinese and English controls follow the existing
application language setting.

Verification: `npm test`, `npm run bundle`, and
`npx playwright test --project=batch-analysis --project=engine-analysis --project=analysis-graph`.
The integration tests replay recorded KataGo output through the real GTP and
analysis parsing pipeline; no GPU or installed KataGo is needed for these tests.
