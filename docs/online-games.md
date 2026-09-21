# Online game records

Open **File → Online Games…** (简体中文：**文件 → 网棋棋谱…**). Select a server
and search by an exact nickname or a player ID. These modes are explicit so
numeric nicknames are not mistaken for IDs. Open a result to download and load
the game; use the existing Save / Save As commands to keep an SGF copy. The
normal unsaved-changes prompt protects the current game.

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
builds.

Each provider implements:

- `id` and `name`: stable identifier and translatable display name.
- `search({keyword, mode, cursor}, request)`: returns
  `{user: {id, name}, games: [{id, black, white, date, result, moves}], nextCursor}`.
  IDs are strings; absent metadata is an empty string or null.
- `download({id}, request)`: returns `{content, extension: 'sgf'}`. Convert
  platform-specific records to SGF and validate them here.

To add Golaxy (星阵围棋) or Tygem, create an adapter beside `fox.js`, register
it in `createService`'s provider list, and add translations for its name and
errors. The selector obtains its choices from the registry. Authentication, if
required by a future platform, belongs in the main process and needs its own
explicit account setup flow. Do not expose credentials to the renderer.

The current UI displays one recent-games snapshot. `nextCursor` is reserved for
future pagination; add a load-more UI when integrating a provider with a
verified paging contract. Fox currently returns `null`; this feature does not
claim to retrieve a player's complete historical archive.

## Fox compatibility and validation

The public endpoints and field aliases are adapted from the local GoAgent
project (`src/main/services/fox.ts`). Requests time out after 15 seconds.
Searches do not download every SGF; records download only when opened. Closing
the panel invalidates pending UI work so a late download cannot replace the
board.

Fox's legacy Chinese-komi value `KM[375]` is normalized to `KM[7.5]` in the root
node, leaving comments and moves intact. Other komi values are preserved. The
compatibility issue is also documented in
[KaTrain issue 177](https://github.com/sanderland/katrain/issues/177).

Run `npm test`, `npm run bundle`, then
`npx playwright test --project=online-games`. Unit tests use deterministic
responses. Electron tests cover loading, empty/error states, Chinese
localization, stale downloads and canceled save prompts. Live service
availability and server retention are outside these deterministic tests.
