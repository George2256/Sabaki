const en = {
  coachPressure:
    'In {diagram}, step {step}, {player} plays {move} and reduces the original {opponent} group at {target} from {before} to {after} liberties. Notice which escape or connection point is being removed. Read a direct answer and a counterattack before deciding whether to defend; fewer liberties alone do not prove a forced result.',
  coachLibertyChoice:
    'Compare the first moves: {best} increases the original group at {target} from {before} to {after} liberties; {comparison} starts with {actual} and leaves that group at {actualAfter}. This shows a concrete difference in defensive timing. Read the opponent’s reply to see whether that extra room matters here; it does not explain the entire score difference by itself.',
  coachGoodChoice:
    'The played move agrees closely with the searched recommendation {best}. Compare it with {actual} in the alternative diagram: predict the opponent’s strongest reply before looking at the continuation, and find what changes on the board.',
  rankKyu: '{rank} kyu',
  rankDan: '{rank} dan',
  styleSources: 'Teaching structure references:',
  learner: 'Learner strength',
  beginner: 'Beginner',
  learnerNote:
    'Self-assessed rank adjusts the teaching depth; KataGo keeps its full playing strength.',
  localInterpretation: 'Board-based explanation',
  reference: '{diagram} · step {step}',
  'llm-invalid': 'The explanation did not pass reference checks after a retry.',
  'llm-timeout': 'The language model timed out.',
  'llm-connection': 'Unable to reach the language model.',
  'invalid-learner': 'Choose a learner strength.',
  'region-corner': 'the corner',
  'region-side': 'the side',
  'region-center': 'the center',
  'region-pass': 'passing',
  coachUrgent:
    'First check the {player} group at {group}: it has only one liberty, at {liberty}. Before playing elsewhere, read the opponent’s capture and your escape. One liberty is a concrete warning; it does not alone prove the group is lost.',
  coachCapture:
    'In {diagram}, step {step}, {player} plays {move} and removes {count} {opponent} stones including {target}. Pause just before this move and find the last liberty. The capture is visible in this line; whether accepting that trade is worthwhile requires the whole-board comparison.',
  coachEscape:
    'In {diagram}, step {step}, {player} plays {move}. The group originally at {target} goes from one liberty to {count}. This is the concrete defensive effect to notice. More liberties give reading room, but are not a proof of life.',
  coachConnect:
    'In {diagram}, step {step}, {player} plays {move} and joins the groups at {first} and {second} into one connected chain. Compare their liberties before and after joining. Connection can reduce separate defensive burdens; it is not always the best choice.',
  coachAtari:
    'In {diagram}, step {step}, {player} plays {move}, leaving the {opponent} group at {target} with only {liberty} as a liberty. Stop here and read the reply: can that group extend, connect or capture? An atari is a threat, not by itself a forced result.',
  coachCompare:
    'The played move {actual} concerns {actualRegion}; the recommendation {best} concerns {bestRegion}. Start both diagrams at step zero and compare what each first move addresses. These short lines show a search preference, but do not yet establish a specific strategic cause for the difference.',
  coachRead:
    'Try reading the opponent’s reply before moving the slider: in {diagram}, step {step}, {player} plays {move}. Return to the preceding step and ask which stones that reply affects. Use the recommended line to check how the response changes.',
  'habit-liberties-foundation':
    'For the next game: count the liberties of your nearby groups before looking for a big point. Ask whether the opponent can capture immediately and whether extending or connecting changes that.',
  'habit-liberties-club':
    'For the next game: compare escaping directly, connecting and counterattacking. Read the opponent’s strongest reply to each before choosing the order of moves.',
  'habit-liberties-advanced':
    'Check the defensive move’s opportunity cost: can you accept the threat, counterattack or trade elsewhere? Extra liberties alone do not settle that comparison.',
  'habit-connect-foundation':
    'For the next game: look for nearby friendly groups that still need separate protection. Read the opponent’s cutting attempt before deciding to connect.',
  'habit-connect-club':
    'Ask whether connecting reduces a real defensive burden, or spends a move linking groups that already have room. Compare the opponent’s best cutting and attacking replies.',
  'habit-connect-advanced':
    'Treat connection as a candidate, not a rule. Compare the connected shape against counterplay or a planned sacrifice, with the whole-board cost in view.',
  'habit-response-foundation':
    'Before playing, ask: what is the opponent’s strongest reply? Count liberties on both sides and read at least that reply before judging a move by how it looks.',
  'habit-response-club':
    'Replay the position just before the tactical event. Compare answering directly, connecting and counterattacking; do not assume the line is forced just because it is shown.',
  'habit-response-advanced':
    'Distinguish the local tactical result from the value of the trade. Check whether sacrificing stones buys initiative or a larger gain elsewhere before calling the capture decisive.',
  'habit-compare-foundation':
    'Use this as a reading exercise: choose a candidate, predict one opponent reply, then compare with the diagram. Do not memorize the recommendation without a reason you can see on the board.',
  'habit-compare-club':
    'Compare what each candidate gains and what response it allows. If the short lines do not reveal the cause, keep the conclusion tentative and deepen the reading.',
  'habit-compare-advanced':
    'Check an alternative plan and its strongest reply. A score gap selects a question to investigate; it does not by itself establish direction, timing or sente.',
  title: 'Teaching explanation',
  close: 'Close teaching section',
  'engine-busy': 'Wait for the current engine move or command to finish.',
  record: 'Game record',
  start: 'Review current branch',
  resume: 'Continue current branch',
  resumeNote:
    'Completed analysis is kept in this window. The same branch, model and search settings can reuse it.',
  reused: 'Reused {count} analysis results',
  preparing: 'Preparing engine and checking cache',
  stop: 'Stop',
  idle: 'Not started',
  scanning: 'Scanning positions',
  verifying: 'Checking teaching moments',
  explaining: 'Writing explanations',
  complete: 'Complete',
  canceled: 'Stopped',
  failed: 'Unable to finish',
  stale: 'The game or selected branch changed. Review it again.',
  empty:
    'No teaching moment passed the evidence checks. Increase the search budget or review another game.',
  engine: 'KataGo',
  prepare: 'Prepare KataGo…',
  rules: 'Rules',
  automatic: 'Use SGF rules',
  chinese: 'Chinese',
  japanese: 'Japanese',
  korean: 'Korean',
  aga: 'AGA',
  'new-zealand': 'New Zealand',
  'tromp-taylor': 'Tromp–Taylor',
  budget: 'Search budget',
  quick: 'Quick',
  standard: 'Standard',
  thorough: 'Thorough',
  black: 'Black',
  white: 'White',
  pass: 'Pass',
  bad: 'Mistake',
  good: 'Good move',
  turning: 'Turning point',
  uncertain: 'Possible mistake',
  move: 'Move {number}',
  locate: 'Locate this move',
  actual: 'Actual game',
  recommended: 'Recommended',
  punishment: 'Best response',
  alternative: 'Comparison',
  actualNote: 'Recorded continuation; not an engine recommendation.',
  verified: 'KataGo PV; replay accepted by KataGo.',
  previous: 'Previous step',
  next: 'Next step',
  reset: 'Reset',
  evidence: 'Evidence',
  metadata: '{rules} rules · komi {komi} · {engine}',
  visits: 'Best / played move visits: {best} / {actual}',
  comparison:
    '{player} played {actual}. Compared with {best}, the estimated loss is {score} points and {winrate} percentage points of win probability.',
  goodComparison:
    '{player} played {actual}, within {score} points of the recommendation. The checked alternative {alternative} loses about {gap} additional points.',
  unstable:
    'The estimated loss changed between search budgets. Treat this as a possible mistake rather than a firm judgment.',
  estimates:
    'These are finite-search estimates. Variations are verified; strategic interpretations are not proofs.',
  llm: 'Optional LLM explanation',
  llmConsent: 'Send verified evidence to my configured LLM endpoint',
  endpoint: 'Chat completions endpoint',
  model: 'Model',
  token: 'API key (this window only)',
  configure: 'Apply connection',
  configured: 'Connection configured for this window',
  interpretation: 'Teaching interpretation (LLM)',
  llmFallback:
    'The LLM response failed validation or the connection failed. The evidence-based explanation is kept.',
  'choose-rules': 'Select the rules: this SGF has no recognized rules.',
  'unsupported-position':
    'This review supports alternating games on 2–19 line boards with initial setup stones. Midgame setup edits, invalid moves or unsupported komi cannot be reviewed.',
  'illegal-variation':
    'A variation could not be replayed legally. It has not been used as evidence.',
  'katago-required':
    'Configure a KataGo engine with gtp and -model arguments, or prepare the automatic engine first.',
  'engine-stopped': 'The teaching engine stopped unexpectedly.',
  'engine-timeout': 'The teaching engine timed out.',
  'invalid-analysis':
    'KataGo did not return usable analysis for this position.',
  'invalid-llm-config':
    'Provide a model and an HTTPS endpoint (HTTP is allowed for localhost).',
  'engine-game': 'Stop the engine game before starting a teaching review.',
  'already-running': 'A teaching review is already running.',
  'unknown-error': 'The teaching review could not finish.',
  back: 'Back to game record',
  skipped: '{count} moments lacked sufficient evidence.',
}
const zh = {
  coachPressure:
    '看{diagram}第 {step} 步：{player}下在 {move}，让原来 {target} 处的{opponent}棋块从 {before} 气减少到 {after} 气。注意对方封住了哪一个逃出或连接的位置，再比较直接应和反击。气减少说明活动余地受到限制，但不能直接判定后续是被迫的。',
  coachLibertyChoice:
    '先比较第一手的作用：推荐 {best} 把原来 {target} 处棋块的气从 {before} 增加到 {after}；{comparison}先走 {actual} 后，这块棋是 {actualAfter} 气。这说明两个选择在防守时机上有具体差别。接着读对方的应手，检查多出的余地在这里有什么用；不能仅凭这一点解释全部目差。',
  coachGoodChoice:
    '实战与引擎推荐的 {best} 很接近。请把它与对照图的 {actual} 比较：先猜对方最强的应手，再看续着，找出棋盘上发生了什么变化。',
  rankKyu: '{rank} 级',
  rankDan: '{rank} 段',
  styleSources: '讲解结构参考：',
  learner: '学员棋力',
  beginner: '刚入门',
  learnerNote: '棋力按自我评估选择，用于调整讲解深度；引擎仍按完整棋力分析。',
  localInterpretation: '棋盘事实讲解',
  reference: '{diagram} · 第 {step} 步',
  'llm-invalid': '重试后，讲解仍未通过引用校验。',
  'llm-timeout': '语言模型响应超时。',
  'llm-connection': '未能连接语言模型。',
  'invalid-learner': '请选择学员棋力。',
  'region-corner': '角部',
  'region-side': '边上',
  'region-center': '中腹',
  'region-pass': '停着',
  coachUrgent:
    '先看 {group} 处的{player}棋块：它只剩 {liberty} 这一口气。落子到别处之前，要先读清对方提子和己方逃出的变化。只剩一气是明确的警报，但不能仅凭气少就断言这块棋已经死了。',
  coachCapture:
    '看{diagram}第 {step} 步：{player}下在 {move}，提掉了包括 {target} 在内的 {count} 颗{opponent}棋子。先停在前一步，找出这些棋最后的一口气。这段变化确实出现了提子；是否值得接受这个交换，还要比较全局得失。',
  coachEscape:
    '看{diagram}第 {step} 步：{player}下在 {move}，原来 {target} 处只剩一气的棋块增加到 {count} 气。这是这手棋可以直接看见的防守作用。气变多意味着多了腾挪空间，但还不能据此说已经做活。',
  coachConnect:
    '看{diagram}第 {step} 步：{player}下在 {move}，把 {first} 和 {second} 处原本分开的棋块接成了一块。对比连接前后的气，看看是否减少了两块棋分别受攻的负担。连接有价值，但并非看到断点就一定要补。',
  coachAtari:
    '看{diagram}第 {step} 步：{player}下在 {move}，使 {target} 处的{opponent}只剩 {liberty} 这一口气。先别往下翻，试着读对方能否长出、连接或反提。这里的打吃是具体威胁，不能直接等同于必然吃住。',
  coachCompare:
    '实战 {actual} 着眼于{actualRegion}，推荐的 {best} 着眼于{bestRegion}。先把两张图都退到起点，比较第一手分别照顾了什么。这段短变化能说明引擎的选择倾向，但还不足以确认差距背后的具体战略原因。',
  coachRead:
    '先试着猜对方的应手，再翻变化：{diagram}第 {step} 步，{player}下在 {move}。退回前一步，看看这手棋影响了哪些棋子，再用推荐图检查对方的应对有什么变化。',
  'habit-liberties-foundation':
    '下次遇到类似局面，先数附近己方棋块的气，再找大场。问自己：对方下一手能不能直接提子？长出或连接以后，这个威胁有没有改变？',
  'habit-liberties-club':
    '下次先比较直接逃出、连接和反击。每个方案都要读对方最强的应手，再决定落子的顺序。',
  'habit-liberties-advanced':
    '进一步比较防守的机会成本：能否承受局部威胁、转为反攻或在别处交换？气增加了，并不能替代这些方案的全局比较。',
  'habit-connect-foundation':
    '下次先找附近还需要分别照顾的己方棋块。不要只看两块棋离得近，先读对方能不能切断，再决定是否连接。',
  'habit-connect-club':
    '判断连接是否减少了真实的防守负担，还是花了一手去连接本来就有余地的棋。分别读对方最强的切断和攻击。',
  'habit-connect-advanced':
    '把连接当成候选方案，比较反击和有计划的弃子；结合全局代价判断，不把连接本身当作目的。',
  'habit-response-foundation':
    '每次落子前先问：对方最厉害的应手是什么？数清双方棋块的气，至少读到对方这一手，再判断自己的着法。',
  'habit-response-club':
    '退回战术发生的前一步，比较直接应、连接和反击。图里展示的是一种经过搜索的变化，不代表每一步都被迫如此。',
  'habit-response-advanced':
    '把局部战术结果与交换价值分开判断。提子之前先检查弃子能否换来主动权或其他地方的收益，不把吃到棋子直接等同于全局有利。',
  'habit-compare-foundation':
    '把这里当成练习：先选一手，猜对方的一手应对，再对照变化图。记住的是棋盘上能看见的理由，而不是推荐坐标。',
  'habit-compare-club':
    '比较每个候选获得了什么，又允许对方怎样应对。短变化看不清原因时，先保留判断，再把变化读深。',
  'habit-compare-advanced':
    '补读另一种计划及其最强应对。目差只是在提示值得研究的问题，不能单独证明行棋方向、时机或先手。',
  title: '教学讲解',
  close: '关闭教学板块',
  'engine-busy': '请等待当前引擎落子或命令完成，再开始讲解。',
  record: '棋谱',
  start: '讲解当前分支',
  resume: '继续讲解当前分支',
  resumeNote:
    '已保留分析结果；分支、模型和搜索设置一致时可继续。缓存仅保留在当前窗口。',
  reused: '已复用 {count} 个分析结果',
  preparing: '正在准备引擎并检查缓存',
  stop: '停止',
  idle: '尚未开始',
  scanning: '正在扫描局面',
  verifying: '正在验证关键变化',
  explaining: '正在生成讲解',
  complete: '已完成',
  canceled: '已停止',
  failed: '未能完成',
  stale: '棋局或选定分支已改变，请重新讲解。',
  empty: '没有节点通过教学证据检查。可以增加搜索预算，或讲解另一盘棋。',
  engine: 'KataGo',
  prepare: '准备 KataGo…',
  rules: '规则',
  automatic: '使用棋谱规则',
  chinese: '中国',
  japanese: '日本',
  korean: '韩国',
  aga: 'AGA',
  'new-zealand': '新西兰',
  'tromp-taylor': 'Tromp–Taylor',
  budget: '搜索预算',
  quick: '快速',
  standard: '标准',
  thorough: '深入',
  black: '黑棋',
  white: '白棋',
  pass: '停一手',
  bad: '坏棋',
  good: '好棋',
  turning: '关键转折',
  uncertain: '疑问手',
  move: '第 {number} 手',
  locate: '定位这手',
  actual: '实战图',
  recommended: '推荐图',
  punishment: '惩罚图',
  alternative: '对照图',
  actualNote: '棋谱中的真实续着，不代表引擎推荐。',
  verified: 'KataGo 主变化；完整续着已交由 KataGo 检查。',
  previous: '上一步',
  next: '下一步',
  reset: '重置',
  evidence: '分析证据',
  metadata: '{rules}规则 · 贴目 {komi} · {engine}',
  visits: '推荐 / 实战着法访问数：{best} / {actual}',
  comparison:
    '{player}实战下在 {actual}。相较 {best}，引擎估计损失约 {score} 目，胜率下降 {winrate} 个百分点。',
  goodComparison:
    '{player}实战下在 {actual}，与推荐着法的差距约 {score} 目。验证过的另一候选 {alternative} 额外损失约 {gap} 目。',
  unstable: '不同搜索预算下的损失估计有变化，暂标为疑问手，不作强结论。',
  estimates: '数值是有限搜索下的估计。变化已验证，战略解释不等于证明。',
  llm: '可选 LLM 讲解',
  llmConsent: '将已验证证据发送到我配置的 LLM 端点',
  endpoint: 'Chat completions 端点',
  model: '模型',
  token: 'API 密钥（仅当前窗口）',
  configure: '应用连接',
  configured: '已为当前窗口配置连接',
  interpretation: '教学推断（LLM）',
  llmFallback: 'LLM 连接失败或输出未通过校验，已保留基于证据的讲解。',
  'choose-rules': '请选择规则：棋谱中没有可识别的规则。',
  'unsupported-position':
    '目前支持 2–19 路、黑白交替落子且只在起点摆子的棋谱。中途摆子、非法落子或不支持的贴目暂不能讲解。',
  'illegal-variation': '变化未能合法重放，未用作讲解证据。',
  'katago-required': '请先配置带 gtp 和 -model 参数的 KataGo，或准备自动引擎。',
  'engine-stopped': '教学分析引擎意外退出。',
  'engine-timeout': '教学分析引擎超时。',
  'invalid-analysis': 'KataGo 未返回此局面的有效分析。',
  'invalid-llm-config': '请填写模型与 HTTPS 端点；本机端点可使用 HTTP。',
  'engine-game': '请先停止引擎对弈，再开始教学讲解。',
  'already-running': '教学讲解正在进行。',
  'unknown-error': '教学讲解未能完成。',
  back: '返回棋谱',
  skipped: '{count} 个候选节点因证据不足未收录。',
}
// Traditional strings share technical names and have their own UI vocabulary.
const hant = {
  ...zh,
  learner: '學員棋力',
  beginner: '剛入門',
  learnerNote: '棋力按自我評估選擇，用於調整講解深度；引擎仍按完整棋力分析。',
  localInterpretation: '棋盤事實講解',
  reference: '{diagram} · 第 {step} 步',
  styleSources: '講解結構參考：',
  title: '教學講解',
  close: '關閉教學板塊',
  'engine-busy': '請等待目前引擎落子或命令完成，再開始講解。',
  record: '棋譜',
  start: '講解目前分支',
  resume: '繼續講解目前分支',
  resumeNote:
    '已保留分析結果；分支、模型和搜尋設定一致時可繼續。快取僅保留在目前視窗。',
  reused: '已重用 {count} 個分析結果',
  preparing: '正在準備引擎並檢查快取',
  idle: '尚未開始',
  scanning: '正在掃描局面',
  verifying: '正在驗證關鍵變化',
  explaining: '正在產生講解',
  complete: '已完成',
  canceled: '已停止',
  failed: '未能完成',
  stale: '棋局或選定分支已改變，請重新講解。',
  black: '黑棋',
  white: '白棋',
  bad: '壞棋',
  good: '好棋',
  turning: '關鍵轉折',
  uncertain: '疑問手',
  actual: '實戰圖',
  recommended: '推薦圖',
  punishment: '懲罰圖',
  alternative: '對照圖',
  locate: '定位這手',
  previous: '上一步',
  next: '下一步',
  rules: '規則',
  automatic: '使用棋譜規則',
  budget: '搜尋預算',
  quick: '快速',
  standard: '標準',
  thorough: '深入',
  prepare: '準備 KataGo…',
  evidence: '分析證據',
  back: '返回棋譜',
  comparison:
    '{player}實戰下在 {actual}。相較 {best}，引擎估計損失約 {score} 目，勝率下降 {winrate} 個百分點。',
  goodComparison:
    '{player}實戰下在 {actual}，與推薦著法的差距約 {score} 目。驗證過的另一候選 {alternative} 額外損失約 {gap} 目。',
  actualNote: '棋譜中的真實續著，不代表引擎推薦。',
  verified: 'KataGo 主變化；完整續著已交由 KataGo 檢查。',
  estimates: '數值是有限搜尋下的估計。變化已驗證，戰略解釋不等於證明。',
  interpretation: '教學推斷（LLM）',
  llmConsent: '將已驗證證據傳送到我設定的 LLM 端點',
  llmFallback: 'LLM 連線失敗或輸出未通過驗證，已保留基於證據的講解。',
}
const dictionaries = {en, 'zh-Hans': zh, 'zh-Hant': hant}
function t(language, key, params = {}) {
  const value = (dictionaries[language] || en)[key] || en[key] || key
  return value.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''))
}
module.exports = {t, dictionaries}
