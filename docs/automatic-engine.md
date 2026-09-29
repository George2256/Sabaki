# Automatic engine setup

On an **Apple silicon Mac running macOS 15 or later**, open a game and click
**Analyze this game** beside the player names below the board. The same command
is available under **Engines**. If no analysis engine is connected, Sabaki opens
the automatic setup panel. Click **Prepare and analyze** to download and check
KataGo, then analyze the currently selected branch. Subsequent analyses reuse
the installation. An already attached analysis engine is used immediately.

In Simplified Chinese these controls are **分析这盘棋** and **准备并分析**.
English, Simplified Chinese and Traditional Chinese are supported.

The initial download is about 380 MB. Reserve approximately 1.5 GB of disk space
for downloading and extraction. Sabaki installs everything in its own user data
directory. It does not install Homebrew, request administrator access or change
shell configuration. The generated configuration uses a small neural network
cache and at most four search threads. Analysis runs locally; the download
servers do not receive your game records.

You can also prepare the engine without starting a game analysis through
**Engines → Automatic engine setup…** or **Preferences → Engines → Automatic
engine setup…**. Other systems can continue to use manually configured engines;
the automatic setup panel explains the current system requirements.

## Downloads and recovery

Downloads try the
[Tsinghua Homebrew mirror](https://mirrors.tuna.tsinghua.edu.cn/help/homebrew-bottles/),
then the
[USTC Homebrew mirror](https://mirrors.ustc.edu.cn/help/homebrew-bottles.html),
then Homebrew's official package registry. This provides domestic download
sources without requiring the user to choose a mirror or configure a proxy.
Availability on a particular network is not guaranteed. The app uses Electron's
network stack, which follows system proxy settings when present.

The macOS 15 ARM64 Homebrew bottle contains KataGo 1.18.2 and its official
`kata1-b18c384nbt-s9996604416-d4316597426.bin.gz` model. Sabaki also downloads
the pinned runtime libraries, including libzip, xz, lz4, zstd, protobuf and
abseil, and launches the engine using this private library directory. It does
not need a separate model download from GitHub or katagotraining.org.

The package versions and SHA-256 digests are pinned in
`src/engine-setup-manifest.js`, using
[Homebrew's formula metadata](https://formulae.brew.sh/api/formula/katago.json).
Every archive is verified before extraction, including downloads from mirrors.
Corrupt downloads and stalled connections fall through to the next source.
Original package license files are retained under the installed engine's
`licenses` directory. Updating a package requires updating and checking its
version, digest, dependencies and supported macOS version together.

The panel shows download progress and the active source. **Cancel** stops
preparation; completely downloaded, verified archives are kept for the next
attempt. Incomplete archives are discarded. After a failure, **Try again**
reuses these verified archives. A failed attempt does not replace an existing
installation or add a broken engine to the settings. Completed installations are
also reusable after restarting Sabaki.

Before registering an engine, setup checks a real analysis sample on a 19×19
board. If the user closes the panel, loads another game or changes branches
during preparation, a late completion cannot start an unwanted analysis.
Browsing positions in the original branch is allowed. For batch analysis
behavior, see [Quick Draw Winrate Graph](batch-analysis.md).

## Verification

Run `npm test`, `npm run bundle`, and
`npx playwright test --project=engine-setup --project=batch-analysis --project=settings-cache`.
Unit tests cover source fallback, digest verification, timeouts, cancellation,
cache reuse, supported systems, transactional installation and safe argument
handling. Electron tests cover first use, retry, cached setup, cancellation,
changing games and localization, using a replay engine without network access or
a GPU.

The initial implementation was also checked on macOS 26.4 ARM64 with a fresh
user data directory: the real Electron downloader fetched the packages, the
private runtime produced a valid analysis sample, the engine was registered and
a three-position 9×9 game received real winrates. This verifies the local
download and analysis flow, not access from every mainland network or operation
on every supported Mac model.
