// Pinned Homebrew bottles, verified against formulae.brew.sh on 2026-09-28.
// Use the macOS 15 build on newer macOS versions too. The KataGo bottle includes
// the official b18 network, so first setup does not need a separate model CDN.
const packages = [
  [
    'katago',
    '1.18.2_2',
    0,
    '7ff0aef28c12264c64b8d03f2b0168a7e92a7b5c9e6bd5ee1cc5ea2a54cd865a',
  ],
  [
    'libzip',
    '1.11.4_1',
    0,
    '6a65f5a729a460ee8988e05e9af08880215a008692dffede96e51694d0a8b428',
  ],
  [
    'xz',
    '5.8.4',
    0,
    'c2724c0db0398134694b8366d30d14f4de376115fb54c559c331d5fd0474af76',
  ],
  [
    'lz4',
    '1.10.0',
    3,
    '91674f1c7407b1f7b73d5bd1d85ed1abaaca93be3b68607af4ef3df632540ac0',
  ],
  [
    'zstd',
    '1.5.7_1',
    0,
    'd72adf48460a8384b256f88061cd7b9df4977df7fa2e0794051d427db754a565',
  ],
  [
    'protobuf',
    '36.2',
    0,
    '153d9b9b322fc8c54fe66dbaf2c8fe382294ee6a8fba35fd4c090dd61de3d77a',
  ],
  [
    'abseil',
    '20260817.0',
    1,
    '8a6b64d5f9d44c579343f1ffa7587d08be653c193f5af24579f6ffc1530431ea',
  ],
].map(([name, version, rebuild, sha256]) => ({
  name,
  root: `${name}/${version}`,
  filename: `${name}-${version}.arm64_sequoia.bottle${rebuild ? `.${rebuild}` : ''}.tar.gz`,
  sha256,
  maxBytes: name === 'katago' ? 450 * 1024 * 1024 : 50 * 1024 * 1024,
}))

exports.manifest = {
  id: 'katago-1.18.2-macos15-arm64-1',
  version: '1.18.2',
  model: 'kata1-b18c384nbt-s9996604416-d4316597426.bin.gz',
  packages,
}

exports.sources = (pkg) => [
  {
    name: 'Tsinghua mirror',
    url: `https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles/${pkg.filename}`,
  },
  {
    name: 'USTC mirror',
    url: `https://mirrors.ustc.edu.cn/homebrew-bottles/${pkg.filename}`,
  },
  {
    name: 'Homebrew official',
    url: `https://ghcr.io/v2/homebrew/core/${pkg.name}/blobs/sha256:${pkg.sha256}`,
    headers: {Authorization: 'Bearer QQ=='},
  },
]
