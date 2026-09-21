// Local additions to the externally maintained @sabaki/i18n catalog.
const simplified = {
  'Online Games…': '网棋棋谱…',
  'Online Games': '网棋棋谱',
  'Fox Go': '野狐围棋',
  Server: '平台',
  'Search by': '查询方式',
  Nickname: '昵称',
  'Player ID': '用户 ID',
  'Player ID or nickname': '用户 ID 或昵称',
  'Enter player ID': '输入用户 ID',
  'Enter exact nickname': '输入完整昵称',
  Search: '查询',
  'Searching…': '查询中…',
  games: '局',
  Date: '日期',
  Black: '黑方',
  White: '白方',
  Result: '结果',
  Moves: '手数',
  Open: '打开',
  'Downloading…': '下载中…',
  Close: '关闭',
  'Find recent games by player ID or exact nickname.':
    '通过用户 ID 或完整昵称查询近期对局。',
  'No recent games found for this player.': '未找到该用户的近期棋谱。',
  'Game records will appear here.': '查询后，对局棋谱会显示在这里。',
  'Recent games available from the server. Open a game, then save it as SGF.':
    '显示平台提供的近期棋谱；打开后可另存为 SGF。',
  'User not found. Check the nickname or try a player ID.':
    '未找到用户，请核对完整昵称或改用用户 ID。',
  'Fox player IDs must contain digits only.': '野狐用户 ID 只能包含数字。',
  'The server could not load the games. Please try again.':
    '平台暂时无法获取棋谱，请重试。',
  'The server returned an invalid response.':
    '平台返回的数据格式异常，请稍后重试。',
  'The server returned an invalid game record.': '平台返回的棋谱内容异常。',
  'The server is unavailable. Please try again later.':
    '平台服务暂不可用，请稍后重试。',
  'The request timed out. Please try again.': '请求超时，请重试。',
  'Cannot connect to the server. Check your connection.':
    '无法连接平台，请检查网络连接。',
  'Enter a valid player ID or nickname.': '请输入有效的用户 ID 或昵称。',
}

const traditional = {
  'Online Games…': '網棋棋譜…',
  'Online Games': '網棋棋譜',
  'Fox Go': '野狐圍棋',
  Server: '平台',
  'Search by': '查詢方式',
  Nickname: '暱稱',
  'Player ID': '使用者 ID',
  'Player ID or nickname': '使用者 ID 或暱稱',
  'Enter player ID': '輸入使用者 ID',
  'Enter exact nickname': '輸入完整暱稱',
  Search: '查詢',
  'Searching…': '查詢中…',
  games: '局',
  Date: '日期',
  Black: '黑方',
  White: '白方',
  Result: '結果',
  Moves: '手數',
  Open: '開啟',
  'Downloading…': '下載中…',
  Close: '關閉',
  'Find recent games by player ID or exact nickname.':
    '透過使用者 ID 或完整暱稱查詢近期對局。',
  'No recent games found for this player.': '未找到該使用者的近期棋譜。',
  'Game records will appear here.': '查詢後，對局棋譜會顯示在這裡。',
  'Recent games available from the server. Open a game, then save it as SGF.':
    '顯示平台提供的近期棋譜；開啟後可另存為 SGF。',
  'User not found. Check the nickname or try a player ID.':
    '未找到使用者，請核對完整暱稱或改用使用者 ID。',
  'Fox player IDs must contain digits only.': '野狐使用者 ID 只能包含數字。',
  'The server could not load the games. Please try again.':
    '平台暫時無法取得棋譜，請重試。',
  'The server returned an invalid response.':
    '平台回傳的資料格式異常，請稍後重試。',
  'The server returned an invalid game record.': '平台回傳的棋譜內容異常。',
  'The server is unavailable. Please try again later.':
    '平台服務暫不可用，請稍後重試。',
  'The request timed out. Please try again.': '請求逾時，請重試。',
  'Cannot connect to the server. Check your connection.':
    '無法連線至平台，請檢查網路連線。',
  'Enter a valid player ID or nickname.': '請輸入有效的使用者 ID 或暱稱。',
}
for (const [key, hans, hant] of [
  ['Unknown game server.', '未知的围棋平台。', '未知的圍棋平台。'],
  ['Invalid search mode.', '无效的查询方式。', '無效的查詢方式。'],
  [
    'Unable to load game servers. Please reopen this panel.',
    '无法加载平台，请关闭后重新打开此面板。',
    '無法載入平台，請關閉後重新開啟此面板。',
  ],
  [
    'Something went wrong. Please try again.',
    '操作失败，请重试。',
    '操作失敗，請重試。',
  ],
]) {
  simplified[key] = hans
  traditional[key] = hant
}
module.exports = {'zh-Hans': simplified, 'zh-Hant': traditional}
