import assert from 'assert'
import {parse, parseFile} from '../src/modules/fileformats/sgf.js'
import {normalizeRoot} from '../src/fox-sgf.js'
import {writeFileSync, mkdtempSync, rmSync} from 'fs'
import {join} from 'path'
import {tmpdir} from 'os'
// push test
describe('Fox SGF komi', () => {
  for (const [rules, komi, expected] of [
    ['Japanese', '550', '5.5'],
    ['Japanese', '650', '6.5'],
    ['Chinese', '375', '7.5'],
    ['Chinese', '325', '6.5'],
    ['Korean', '650', '6.5'],
    ['Japanese', '-550', '-5.5'],
    ['Chinese', '7.5', '7.5'],
    ['Japanese', '0', '0'],
    ['unknown', '550', '550'],
  ]) {
    it(`normalizes ${rules} KM[${komi}] to ${expected}`, () => {
      const [tree] = parse(
        `(;AP[GNU Go:3.8]AP[foxwq]RU[${rules}]KM[${komi}];B[aa])`,
      )
      assert.equal(tree.root.data.KM[0], expected)
      normalizeRoot(tree.root.data)
      assert.equal(tree.root.data.KM[0], expected)
    })
  }
  it('repairs a saved Fox SGF whose AP marker was replaced by Sabaki', () => {
    const [ordinary] = parse('(;KM[550]RU[Japanese];B[aa])')
    assert.equal(ordinary.root.data.KM[0], '5.5')
    const [saved] = parse(
      '(;AP[Sabaki:0.60.2]RU[Japanese]KM[550]PB[聂卫平]PW[藤泽秀行];B[aa])',
    )
    assert.equal(saved.root.data.KM[0], '5.5')
  })
  it('preserves ordinary komi, comments, variations and moves', () => {
    const [fox] = parse(
      '(;AP[foxwq]RU[Japanese]KM[550]C[keep KM[550\\] text](;B[aa])(;B[bb]))',
    )
    assert.equal(fox.root.data.C[0], 'keep KM[550] text')
    assert.equal(fox.root.children.length, 2)
    assert.deepEqual(
      fox.root.children.map((n) => n.data.B[0]),
      ['aa', 'bb'],
    )
    const [normal] = parse('(;AP[Sabaki:0.60.2]RU[Japanese]KM[6.5];B[aa])')
    assert.equal(normal.root.data.KM[0], '6.5')
  })
  it('also fixes previously saved Fox SGFs loaded from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sabaki-fox-test-'))
    try {
      const filename = join(dir, 'game.sgf')
      writeFileSync(filename, '(;AP[foxwq]RU[Japanese]KM[550];B[aa])')
      assert.equal(parseFile(filename)[0].root.data.KM[0], '5.5')
    } finally {
      rmSync(dir, {recursive: true, force: true})
    }
  })
})
