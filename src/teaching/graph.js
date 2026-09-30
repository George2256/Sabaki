// The graph reuses final root evaluations from the teaching scan. It never
// derives a branch curve from forced moves or verification variations.
function scanGraph(scan, total) {
  const winrate = Array(total).fill(null)
  const scoreLead = Array(total).fill(null)
  scan.forEach(({root}, turn) => {
    winrate[turn] = Math.round(root.winrate * 10000) / 100
    scoreLead[turn] = root.scoreLead
  })
  return {winrate, scoreLead, completed: scan.length, total}
}

function graphForNodes(position, review, nodes) {
  if (
    !position ||
    !review?.graph ||
    review.stale ||
    review.rootId !== position.rootId ||
    nodes[0]?.id !== position.rootId ||
    review.graph.winrate.length !== position.moves.length + 1 ||
    review.graph.scoreLead.length !== position.moves.length + 1
  )
    return null
  const moveNodes = nodes.filter((node) => node.data.B || node.data.W)
  if (
    moveNodes.length !== position.anchors.length ||
    moveNodes.some((node, i) => node.id !== position.anchors[i].nodeId)
  )
    return null
  let turn = 0
  const turns = nodes.map((node) => {
    // A move on the root is already on its board; leading comment nodes and
    // setup nodes instead show scan[0]. Non-move nodes share the prior board.
    if (node.data.B || node.data.W) turn++
    return turn
  })
  return {
    ...review.graph,
    winrate: turns.map((i) => review.graph.winrate[i]),
    scoreLead: turns.map((i) => review.graph.scoreLead[i]),
  }
}

module.exports = {scanGraph, graphForNodes}
