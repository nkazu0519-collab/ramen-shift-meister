// マイスター一括管理（buildMeisterBulkRows_・validateMeisterBulkChanges_）を、本番のapp内の
// 全.gsファイルをNode.jsのvmで直接読み込んで検証する。ロジックをこのファイルへコピーしない
// （実行方法・検証範囲の詳細はREADME.mdを参照）。
//
// app内の.gsファイル構成はファイル分割の進行に応じて変わるため、読み込みは共通ヘルパー
// load_all_gs_.js に委ねる。
//
// 実行: node meister_bulk_test.js
// 失敗時は終了コード1で終わる。

'use strict'

var loadAllGsIntoSandbox_ = require('./load_all_gs_').loadAllGsIntoSandbox_

function loadProductionCode() {
  return loadAllGsIntoSandbox_().sandbox
}

var prod = loadProductionCode()

var pass = 0, fail = 0
function assertEqual(actual, expected, label) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label + ' -> ' + JSON.stringify(actual) + (ok ? '' : ' (expected ' + JSON.stringify(expected) + ')'))
  if (ok) pass++; else fail++
}
function assertTrue(actual, label) { assertEqual(!!actual, true, label) }

console.log('検証対象: ' + loadAllGsIntoSandbox_().loadedFiles.join(', '))
console.log('---')

// ==== 1. freee従業員とマイスターマスタをIDで結合し、未登録者を全falseにする ====
var employees1 = [
  { id: 101, display_name: '釜田太一' },
  { id: 102, display_name: '富安武彦' }
]
var summaries1 = {
  '101': { employee_id: '101', acquired_meisters: ['ホール', 'セット'], score: 7, registered: true }
  // 102は未登録（マイスターマスタに行がない）
}
var rows1 = prod.buildMeisterBulkRows_(employees1, summaries1)
assertEqual(rows1.length, 2, '1. 結合結果は従業員数と同じ2行')
assertEqual(rows1[0].employee_id, '101', '1. 1行目は101（文字列化されている）')
assertEqual(rows1[0].badges, { '手洗い伝道師': false, 'ホール': true, 'セット': true, '仕込み': false, '麺上げ': false }, '1. 101の取得状況がマイスターマスタどおり')
assertEqual(rows1[1].employee_id, '102', '1. 2行目は102')
assertEqual(rows1[1].badges, { '手洗い伝道師': false, 'ホール': false, 'セット': false, '仕込み': false, '麺上げ': false }, '1. 未登録の102は全マイスターfalse')

// ==== 2. 複数従業員・複数マイスターの変更を正規化できる（=検証を通過する）====
var validEmployeeIds = ['101', '102', '103']
var multiChange = [
  { employee_id: '101', badges: { 'ホール': true, 'セット': false } },
  { employee_id: '102', badges: { '麺上げ': true, '仕込み': true, '手洗い伝道師': true } }
]
var v2 = prod.validateMeisterBulkChanges_(multiChange, validEmployeeIds)
assertTrue(v2.valid, '2. 複数従業員・複数マイスターの変更は検証を通過する')

// ==== 3. 全falseの更新を保持する（＝検証で拒否されない）====
var allFalseChange = [
  { employee_id: '103', badges: { '手洗い伝道師': false, 'ホール': false, 'セット': false, '仕込み': false, '麺上げ': false } }
]
var v3 = prod.validateMeisterBulkChanges_(allFalseChange, validEmployeeIds)
assertTrue(v3.valid, '3. 全チェックを外した（全false）更新は検証を通過する')

// ==== 4. 重複従業員IDを拒否する ====
var dupChange = [
  { employee_id: '101', badges: { 'ホール': true } },
  { employee_id: '101', badges: { 'セット': true } }
]
var v4 = prod.validateMeisterBulkChanges_(dupChange, validEmployeeIds)
assertEqual(v4.valid, false, '4. 同一リクエスト内の重複従業員IDは拒否される')

// ==== 5. 存在しない従業員IDを拒否する ====
var unknownIdChange = [
  { employee_id: '999', badges: { 'ホール': true } }
]
var v5 = prod.validateMeisterBulkChanges_(unknownIdChange, validEmployeeIds)
assertEqual(v5.valid, false, '5. freee従業員一覧に存在しないIDは拒否される')

// ==== 6. 未定義のマイスターキーを拒否する ====
var unknownKeyChange = [
  { employee_id: '101', badges: { '店長特権': true } }
]
var v6 = prod.validateMeisterBulkChanges_(unknownKeyChange, validEmployeeIds)
assertEqual(v6.valid, false, '6. MEISTER_KEYS以外の未定義キーは拒否される')

// ==== 7. boolean以外の値を拒否する ====
var nonBooleanCases = [
  { employee_id: '101', badges: { 'ホール': 'true' } },   // 文字列
  { employee_id: '101', badges: { 'ホール': 1 } },         // 数値
  { employee_id: '101', badges: { 'ホール': null } },      // null
  { employee_id: '101', badges: { 'ホール': undefined } }  // undefined
]
for (var nb = 0; nb < nonBooleanCases.length; nb++) {
  var vNb = prod.validateMeisterBulkChanges_([nonBooleanCases[nb]], validEmployeeIds)
  assertEqual(vNb.valid, false, '7. boolean以外の値（ケース' + nb + '）は拒否される')
}

// ==== 8. 入力エラー時に書込み処理へ進まない構造になっている ====
// saveMeisterBulkChanges自体はSpreadsheetApp/getEmployees（外部API）に依存するため、
// このテストでは直接実行しない。代わりに、saveMeisterBulkChangesの関数本文が
// 「validateMeisterBulkChanges_の結果を見てから書き込みに入る」構造になっていることを、
// ソースコード上の呼び出し順で確認する（validateの呼び出しがLockService取得より前にあること）
var fnSource = prod.saveMeisterBulkChanges.toString()
var validateIdx = fnSource.indexOf('validateMeisterBulkChanges_')
var lockIdx = fnSource.indexOf('LockService')
assertTrue(validateIdx >= 0, '8. saveMeisterBulkChangesはvalidateMeisterBulkChanges_を呼んでいる')
assertTrue(lockIdx >= 0, '8. saveMeisterBulkChangesはLockServiceを使っている')
assertTrue(validateIdx < lockIdx, '8. 検証（validateMeisterBulkChanges_）はロック取得より前に行われる＝不正なら書込みへ進まない')
// 追加確認: 不正な変更内容そのものが、書き込み用のsetValues呼び出しへ絶対に渡らないことを、
// validateMeisterBulkChanges_単体の戻り値で再確認する（他のテストケースと矛盾しないことの最終防御）
var badForWrite = [{ employee_id: '101', badges: { 'ホール': 'yes' } }]
assertEqual(prod.validateMeisterBulkChanges_(badForWrite, validEmployeeIds).valid, false, '8. 不正データは検証時点でvalid:falseになる（書込み関数へ渡さない前提）')

// ==== 追加の回帰確認: 空配列・非配列・欠損employee_idも拒否する ====
assertEqual(prod.validateMeisterBulkChanges_([], validEmployeeIds).valid, false, '回帰: 空配列は拒否される（変更がありません）')
assertEqual(prod.validateMeisterBulkChanges_(null, validEmployeeIds).valid, false, '回帰: null（非配列）は拒否される')
assertEqual(prod.validateMeisterBulkChanges_([{ badges: { 'ホール': true } }], validEmployeeIds).valid, false, '回帰: employee_id欠損は拒否される')
assertEqual(prod.validateMeisterBulkChanges_([{ employee_id: '101' }], validEmployeeIds).valid, false, '回帰: badges欠損は拒否される')
assertEqual(prod.validateMeisterBulkChanges_([{ employee_id: '101', badges: ['ホール'] }], validEmployeeIds).valid, false, '回帰: badgesが配列（object typeofは通るがArray）は拒否される')

// ==== 9. 技能別の育成優先度（buildMeisterSkillPriority_）====
// 07_ブラッシュアップ/02_企画・設計/技能別育成優先度_最小仕様.md 対応

// 9a. 4技能を必ず返し、手洗い伝道師を含めない
var rowsForPriority9a = [
  { employee_id: '1', employee_name: 'A', badges: { '手洗い伝道師': true, 'ホール': true, 'セット': false, '仕込み': false, '麺上げ': false } }
]
var priority9a = prod.buildMeisterSkillPriority_(rowsForPriority9a)
assertEqual(priority9a.length, 4, '9a. 育成優先度は4件（ホール・セット・仕込み・麺上げ）')
var keys9a = priority9a.map(function (p) { return p.key })
assertTrue(keys9a.indexOf('手洗い伝道師') === -1, '9a. 手洗い伝道師は育成優先度に含めない')
assertEqual(keys9a.sort(), ['セット', 'ホール', '仕込み', '麺上げ'].sort(), '9a. 対象は固定4技能のみ')

// 9b/9c/9d. 0人「担当者なし」、1人「一人依存・育成優先」、2人以上「保有者N人」
var rowsForPriority9b = [
  { employee_id: '1', employee_name: '従業員A', badges: { '手洗い伝道師': false, 'ホール': true, 'セット': true, '仕込み': false, '麺上げ': false } },
  { employee_id: '2', employee_name: '従業員B', badges: { '手洗い伝道師': false, 'ホール': true, 'セット': false, '仕込み': false, '麺上げ': false } },
  { employee_id: '3', employee_name: '従業員C', badges: { '手洗い伝道師': false, 'ホール': true, 'セット': false, '仕込み': false, '麺上げ': false } }
]
var priority9b = prod.buildMeisterSkillPriority_(rowsForPriority9b)
var byKey9b = {}
for (var pb = 0; pb < priority9b.length; pb++) byKey9b[priority9b[pb].key] = priority9b[pb]
assertEqual(byKey9b['麺上げ'].holder_count, 0, '9b. 麺上げは0人')
assertEqual(byKey9b['麺上げ'].status, 'none', '9b. 0人はstatus:none')
assertEqual(byKey9b['麺上げ'].status_label, '担当者なし', '9b. 0人は「担当者なし」')
assertEqual(byKey9b['セット'].holder_count, 1, '9c. セットは1人')
assertEqual(byKey9b['セット'].status, 'single', '9c. 1人はstatus:single')
assertEqual(byKey9b['セット'].status_label, '一人依存・育成優先', '9c. 1人は「一人依存・育成優先」')
assertEqual(byKey9b['ホール'].holder_count, 3, '9d. ホールは3人')
assertEqual(byKey9b['ホール'].status, 'multiple', '9d. 2人以上はstatus:multiple')
assertEqual(byKey9b['ホール'].status_label, '保有者3人', '9d. 2人以上は「保有者N人」')

// 9e. 「十分」「安全」「問題なし」「安定」という表現を使わない
var forbiddenWords9e = ['十分', '安全', '問題なし', '安定']
for (var pw = 0; pw < priority9b.length; pw++) {
  for (var fw = 0; fw < forbiddenWords9e.length; fw++) {
    assertTrue(priority9b[pw].status_label.indexOf(forbiddenWords9e[fw]) === -1, '9e. status_labelに「' + forbiddenWords9e[fw] + '」を含まない（' + priority9b[pw].key + '）')
  }
}

// 9f. 人数の少ない順（0人→1人→2人以上）
var counts9f = priority9b.map(function (p) { return p.holder_count })
var sortedCounts9f = counts9f.slice().sort(function (a, b) { return a - b })
assertEqual(counts9f, sortedCounts9f, '9f. 保有人数の少ない順に並んでいる')

// 9g. 同数時はホール→セット→仕込み→麺上げの固定順
var rowsForPriority9g = [] // 全員未登録（全技能0人）
var priority9g = prod.buildMeisterSkillPriority_(rowsForPriority9g)
assertEqual(priority9g.map(function (p) { return p.key }), ['ホール', 'セット', '仕込み', '麺上げ'], '9g. 同数（全員0人）時はホール→セット→仕込み→麺上げの固定順')

// 9h. holder_namesがrows（=freee従業員一覧）の順を維持する
var rowsForPriority9h = [
  { employee_id: '3', employee_name: '従業員C', badges: { '手洗い伝道師': false, 'ホール': true, 'セット': false, '仕込み': false, '麺上げ': false } },
  { employee_id: '1', employee_name: '従業員A', badges: { '手洗い伝道師': false, 'ホール': true, 'セット': false, '仕込み': false, '麺上げ': false } },
  { employee_id: '2', employee_name: '従業員B', badges: { '手洗い伝道師': false, 'ホール': true, 'セット': false, '仕込み': false, '麺上げ': false } }
]
var priority9h = prod.buildMeisterSkillPriority_(rowsForPriority9h)
var hallHolders9h = priority9h.filter(function (p) { return p.key === 'ホール' })[0].holder_names
assertEqual(hallHolders9h, ['従業員C', '従業員A', '従業員B'], '9h. holder_namesはrows（freee従業員一覧）の順を維持する')

// 9i. 未登録従業員（badgesが全falseの行）は保有者として数えない。9jで別途、freee一覧に存在しない孤立IDが
//     buildMeisterBulkRows_の時点でrowsに現れないことを確認する
var rowsForPriority9i = [
  { employee_id: '1', employee_name: '従業員A', badges: { '手洗い伝道師': false, 'ホール': false, 'セット': false, '仕込み': false, '麺上げ': false } }
]
var priority9i = prod.buildMeisterSkillPriority_(rowsForPriority9i)
for (var p9i = 0; p9i < priority9i.length; p9i++) {
  assertEqual(priority9i[p9i].holder_count, 0, '9i. 未登録従業員はどの技能も保有者として数えない（' + priority9i[p9i].key + '）')
}

// 9j. freee一覧に存在しない孤立ID（マイスターマスタのみに存在するID）は、buildMeisterBulkRows_の
//     段階でrowsに含まれないため、buildMeisterSkillPriority_へも渡らない（既存回帰の確認）
var employees9j = [{ id: 201, display_name: '在籍従業員' }]
var summaries9j = {
  '201': { employee_id: '201', acquired_meisters: ['ホール'], score: 3, registered: true },
  '999': { employee_id: '999', acquired_meisters: ['ホール', 'セット'], score: 7, registered: true } // 孤立ID（freee一覧になし）
}
var rows9j = prod.buildMeisterBulkRows_(employees9j, summaries9j)
assertEqual(rows9j.length, 1, '9j. 孤立ID（999）はbuildMeisterBulkRows_の時点でrowsに含まれない')
var priority9j = prod.buildMeisterSkillPriority_(rows9j)
var hallHolders9j = priority9j.filter(function (p) { return p.key === 'ホール' })[0]
assertEqual(hallHolders9j.holder_count, 1, '9j. 孤立ID分の保有はskill_priorityへ混入しない（ホールは在籍従業員の1人のみ）')
assertEqual(hallHolders9j.holder_names, ['在籍従業員'], '9j. holder_namesに孤立IDの従業員名が混ざらない')

// 9k. 従業員0人（空配列）でも例外にせず、4技能を0人として返す
var priority9k = prod.buildMeisterSkillPriority_([])
assertEqual(priority9k.length, 4, '9k. 従業員0人でも4技能を返す')
for (var p9k = 0; p9k < priority9k.length; p9k++) {
  assertEqual(priority9k[p9k].holder_count, 0, '9k. 従業員0人時は' + priority9k[p9k].key + 'も0人')
  assertEqual(priority9k[p9k].status, 'none', '9k. 従業員0人時は' + priority9k[p9k].key + 'もstatus:none')
}

// 9l. 入力rowsを変更しない
var rowsForPriority9l = [
  { employee_id: '1', employee_name: '従業員A', badges: { '手洗い伝道師': false, 'ホール': true, 'セット': false, '仕込み': false, '麺上げ': false } }
]
var rowsSnapshot9l = JSON.parse(JSON.stringify(rowsForPriority9l))
prod.buildMeisterSkillPriority_(rowsForPriority9l)
assertEqual(rowsForPriority9l, rowsSnapshot9l, '9l. buildMeisterSkillPriority_は入力rowsを変更しない')

// ==== 10. getMeisterBulkView()がrowsとskill_priorityを同じ取得結果から返す ====
// getEmployees・SpreadsheetAppに依存するgetMeisterBulkView自体は直接実行しないが、
// 関数本文がbuildMeisterBulkRows_の戻り値（rows）をそのままbuildMeisterSkillPriority_へ渡し、
// getEmployees()・getAllMaisterSummaries()を1回ずつしか呼ばない構造であることをソース上で確認する
var viewFnSource10 = prod.getMeisterBulkView.toString()
var getEmployeesCount10 = (viewFnSource10.match(/getEmployees\(\)/g) || []).length
var getSummariesCount10 = (viewFnSource10.match(/getAllMaisterSummaries\(\)/g) || []).length
assertEqual(getEmployeesCount10, 1, '10. getMeisterBulkView内でgetEmployees()の呼び出しは1回のみ')
assertEqual(getSummariesCount10, 1, '10. getMeisterBulkView内でgetAllMaisterSummaries()の呼び出しは1回のみ')
assertTrue(viewFnSource10.indexOf('buildMeisterSkillPriority_(rows)') >= 0, '10. skill_priorityはbuildMeisterBulkRows_と同じrowsから計算している')

console.log('---')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
