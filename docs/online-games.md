# Online game records

Open **File → Online Games…** (简体中文：**文件 → 网棋棋谱…**). Select a server
and search by an exact nickname or a player ID. These modes are explicit so
numeric nicknames are not mistaken for IDs. Open a result to download and load
the game; use the existing Save / Save As commands to keep an SGF copy. The
normal unsaved-changes prompt protects the current game.

The selector includes **Fox Go**, **Tencent Go** (简体中文：**腾讯围棋**) and
**OGS (Online-Go.com)**. Tencent is the platform at
[txwq.qq.com](https://txwq.qq.com/) and uses its own account and record
endpoints. It is not a Fox alias: `George2256` / `35938987` is a verified
Tencent account absent from Fox's nickname lookup.

Tencent nickname and ID searches resolve the player through its personal-info
endpoint, then request the player's recent records through `TXWQFetchChessList`
with `type=7`, `frommobile=1`, `srcuid=0`, and the verified nickname. The list
request must include a nonempty `txwqsession` field; the public endpoint accepts
the anonymous value `0`. Omitting it or sending an empty string returns error
`1000002`. This was verified against the official mobile client's request and
live server responses, and currently requires no Tencent login in Sabaki.

Live nickname and ID searches for George2256 on 2026-10-13 returned 20 records,
all with player ID `35938987` as Black or White, including the supplied shared
game below. `test/resources/tencent-player-list.json` retains a small response
sample. Tencent's `reason` field distinguishes resignations and timeouts even
when `point` is zero; the adapter normalizes these to `B/W+R` and `B/W+T`.

If Tencent rejects a list request, the panel preserves the verified player and
reports an unavailable list, instead of claiming the player has no games. Every
returned game must belong to the verified player; unrelated global snapshots
from `FetchChessSummary` are not accepted as player search results.

Tencent also supports **Game share link**: paste an official
`h5.txwq.qq.com/txwqshare/index.html?chessid=…` link to load one public record
through Tencent's `TXWQFetchChess` endpoint. Only the numeric `chessid` is used;
the app never fetches a user-supplied URL. The SGF can be opened and saved as
usual. This is a single-game import, not a replacement for player-list search.

The supplied share link for `1791815734932291925` was verified through the live
provider and Electron import: George2256 (Black) vs. 围棋精灵 (White),
2026-10-12, 19x19, 149 moves, `B+R`. Tencent's `KM[375]` is normalized to 7.5
points by the existing SGF importer. `test/sgf/tencent-ai-game.sgf` retains the
original response as a regression fixture. The share title/description is not
used to determine the players; those values come from the actual SGF.

## OGS

Select **OGS (Online-Go.com)** to find public game records by exact,
case-sensitive username or a positive numeric player ID. OGS usernames and IDs
are distinct search modes, including when a username contains only digits. No
login is required for these public records. Private or unavailable games show an
explicit error; Sabaki does not request account credentials.

The adapter uses OGS's [official REST API](https://docs.online-go.com/):

- `/api/v1/players/?username=…` resolves an exact username;
  `/api/v1/players/{id}/` verifies an ID.
- `/api/v1/players/{id}/games/` requests finished games with
  `ended__isnull=false`, `ordering=-ended`, and `page_size=20`. **Load more**
  appends earlier games without duplicates. A failed page keeps the loaded
  records and can be retried. Changing the query clears pagination.
- **Game share link** accepts `https://online-go.com/game/{id}` and official
  `/api/v1/games/{id}/sgf` links. Only the ID is extracted; metadata is fetched
  from the fixed `/api/v1/games/{id}/` endpoint.
- Opening a game downloads SGF text from `/api/v1/games/{id}/sgf`, validates it,
  and uses the normal import/save flow. Comments, variations, names, komi, board
  size and moves are preserved.

OGS's list response omits move counts, displayed as **—**. Link lookup can
display the count from game details. List searches do not download individual
SGFs. Historical names in game details or SGF may differ from current usernames
in the player list. Resignations, timeouts and scored wins are displayed using
`B/W+R`, `B/W+T` and `B/W+points`.

Pagination follows OGS's verified page-number contract. Only a validated page
number crosses IPC; neither the renderer nor the API's `next` field can select
an arbitrary request URL. Each request retains the shared 15-second timeout;
rate limits ask the user to retry later.

Live username/ID searches, a second page, game-link lookup and SGF download were
verified on 2026-10-18. `test/resources/ogs-player-list.json` retains two
records from a public response with unrelated profile/rating fields omitted.
`test/sgf/ogs-game.sgf` retains game `88868859`: 한지석 vs. anoek, 9×9, 23
moves, komi 6.5, `W+R`.

The panel follows Sabaki's language setting, with English, Simplified Chinese
and Traditional Chinese strings. New strings are maintained in
`src/online-games/strings.js`, supplementing the upstream translation package.
Other languages currently fall back to English for this feature.

## Provider boundary

`src/online-games/index.js` runs in the main process and owns the provider
registry and shared request timeout/error handling. Its narrow preload API
returns `{ok: true, data}` or `{ok: false, error}`. Network endpoints belong to
providers; the renderer cannot supply a URL. Main-process code must remain
outside `src/modules` and `src/components`, which are excluded from packaged
builds. Tencent share-link search parses the downloaded SGF in the main process,
so the packaging allowlist includes `@sabaki/sgf` and its `doken` dependency.

Each provider implements:

- `id` and `name`: stable identifier and translatable display name.
- `modes` (optional): supported search modes; defaults to nickname and ID.
- `search({keyword, mode, cursor}, request)`: returns
  `{user: {id, name}, games: [{id, black, white, date, result, moves}], nextCursor}`.
  IDs are strings; absent metadata is an empty string or null. Share-link search
  returns `user: null`. An optional `notice` distinguishes a verified player
  with an unavailable list from a successful empty list.
- `download({id}, request)`: returns `{content, extension: 'sgf'}`. Convert
  platform-specific records to SGF and validate them here.

To add Golaxy (星阵围棋) or Tygem, create an adapter beside `fox.js`, register
it in `createService`'s provider list, and add translations for its name and
errors. The selector obtains its choices from the registry. Authentication, if
required by a future platform, belongs in the main process and needs its own
explicit account setup flow. Do not expose credentials to the renderer.

Providers return `nextCursor` when more records are available. The UI appends
pages through **Load more**, preserves existing results on a failed page, and
discards pending work when closed. OGS returns validated page numbers; Fox and
Tencent currently return `null` and expose one recent-games snapshot.

## Fox compatibility and validation

The public endpoints and field aliases are adapted from the local GoAgent
project (`src/main/services/fox.ts`). Requests time out after 15 seconds. Player
searches do not download every SGF; records download only when opened. Closing
the panel invalidates pending UI work so a late download cannot replace the
board.

The SGF importer normalizes legacy encoded komi according to `RU`:
Japanese/Korean values are divided by 100 (`550 → 5.5`, `650 → 6.5`), and
Chinese values by 50 (`375 → 7.5`). Standard-sized komi, unknown rules, comments
and moves are preserved. This happens in both string and file import, so
previously saved Fox records remain repairable after Sabaki has replaced the
original `AP[foxwq]` marker on save. Conversion is idempotent when an imported
game is saved and reopened. The regression was reproduced with Fox game
`1760680258080010005` (Nie Weiping vs. Fujisawa Hideyuki, 1985-11-20): KataGo
rejected the unconverted `komi 550`.

Run `npm test`, `npm run bundle`, then
`npx playwright test --project=online-games`. Unit tests use deterministic
responses. Electron tests cover loading, empty/error states, OGS search/link
imports and pagination retries, Chinese localization, stale downloads and
canceled save prompts. Live service availability and server retention are
outside these deterministic tests.
