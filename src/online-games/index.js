const fox = require('./fox')

// Providers own network endpoints and normalization; the renderer sees only
// serializable player/game summaries and SGF content, never arbitrary URLs.
function createService({
  providers = [fox],
  fetchImpl = (...args) => fetch(...args),
} = {}) {
  const registry = new Map(providers.map((provider) => [provider.id, provider]))
  async function request(endpoint, params) {
    const url = new URL(endpoint)
    Object.entries(params).forEach(([key, value]) =>
      url.searchParams.set(key, value),
    )
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(15000),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
          Accept: 'application/json,text/plain,*/*',
        },
      })
      if (!response.ok)
        throw new Error('The server is unavailable. Please try again later.')
      const json = await response.json()
      if (!json || typeof json !== 'object' || Array.isArray(json))
        throw new Error('The server returned an invalid response.')
      return json
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError')
        throw new Error('The request timed out. Please try again.')
      if (error instanceof TypeError)
        throw new Error('Cannot connect to the server. Check your connection.')
      if (error instanceof SyntaxError)
        throw new Error('The server returned an invalid response.')
      throw error
    }
  }
  function provider(id) {
    if (!registry.has(id)) throw new Error('Unknown game server.')
    return registry.get(id)
  }
  function value(input, max) {
    if (typeof input !== 'string' || !input.trim() || input.length > max)
      throw new Error('Enter a valid player ID or nickname.')
    return input.trim()
  }
  return {
    list: () => [...registry.values()].map(({id, name}) => ({id, name})),
    search: (input = {}) => {
      const source = provider(input.provider)
      const keyword = value(input.keyword, 100)
      if (!['id', 'nickname'].includes(input.mode))
        throw new Error('Invalid search mode.')
      return source.search(
        {keyword, mode: input.mode, cursor: input.cursor ?? null},
        request,
      )
    },
    download: (input = {}) =>
      provider(input.provider).download({id: value(input.id, 200)}, request),
  }
}

module.exports = {createService}
