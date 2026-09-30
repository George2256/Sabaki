const ranks = ['beginner', '20k', '15k', '10k', '5k', '1k', '1d', '3d', '5d']

function learnerProfile(rank = '10k') {
  if (!ranks.includes(rank)) throw new Error('invalid-learner')
  const tier =
    ranks.indexOf(rank) <= 3
      ? 'foundation'
      : ranks.indexOf(rank) <= 5
        ? 'club'
        : 'advanced'
  const guidance = {
    foundation:
      'Explain liberties, atari and connection in plain language. Focus on one immediately usable habit. Show a short concrete response before using a Go term.',
    club: 'Explain attack versus defense, connection and the order of moves. Compare the actual and recommended plan using specific groups and responses. End with a practical reading question.',
    advanced:
      'Discuss the local versus whole-board tradeoff, timing and counterplay when the evidence supports them. Avoid rules-of-thumb without exceptions. Separate concrete reading from strategic interpretation.',
  }
  return {rank, tier, guidance: guidance[tier]}
}

module.exports = {ranks, learnerProfile}
