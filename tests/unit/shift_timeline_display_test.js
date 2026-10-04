// レビュー対応（シフト表の表示対象変更 2026-09-16）：表示対象と登録対象を分け、表の情報量を
// 減らすため、選択営業日に「希望または勤務がある人」だけを表に表示し、どちらもない人は表から
// 隠す（「直接シフトを登録」の従業員選択はサーバー側テンプレートでemployees全件から独立して
// 生成しているため、この絞り込みの影響を受けず引き続き全員を選べる）。
// 以前は①希望/勤務ありグループ→②なしグループの2グループで全員表示していたが、
// 今回はグループ②（なし）を表示対象から除外するだけの変更にした（buildDisplayOrderedEmployees_
// をbuildDisplayedEmployees_へ改名し、絞り込みだけを行う関数にした）。
//
// このファイルは新しい表示ロジックを、本番のjs_shift.htmlから関数本体をそのまま抽出して
// Node.jsのvmで実行し検証する（ロジックをテスト側へ再実装しない）。DOM操作を伴う
// renderEmployeeRows全体ではなく、DOM非依存の純粋関数buildEmployeeHasEntryMap_・
// buildDisplayedEmployees_だけを対象にする単体検証と、renderEmployeeRows全体を
// フェイクDOMで実行する結合検証の両方を行う。
//
// 表内スクロール・見出し固定のCSS構造は別ファイル（shift_timeline_scroll_structure_test.js）で検証する。
//
// 実行: node shift_timeline_display_test.js
// 失敗時は終了コード1で終わる。

'use strict'

var fs = require('fs')
var path = require('path')
var vm = require('vm')

var APP_DIR = path.join(__dirname, '..', '..', 'src')

var pass = 0, fail = 0
function assertEqual(actual, expected, label) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label + ' -> ' + JSON.stringify(actual) + (ok ? '' : ' (expected ' + JSON.stringify(expected) + ')'))
  if (ok) pass++; else fail++
}
function assertTrue(actual, label) {
  var ok = !!actual
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label)
  if (ok) pass++; else fail++
}
/**
 *  キーの挿入順に依存せず、オブジェクトの中身（キー集合と各値）だけを比較する
 *  （buildEmployeeHasEntryMap_はfor...inの列挙順＝entries→wishesの走査順でキーが決まるため、
 *  期待値をJSON.stringifyでそのまま比較すると挿入順の違いだけで誤って不一致になる）
 */
function assertObjectEqual(actual, expected, label) {
  var actualKeys = Object.keys(actual).sort()
  var expectedKeys = Object.keys(expected).sort()
  var keysMatch = JSON.stringify(actualKeys) === JSON.stringify(expectedKeys)
  var valuesMatch = keysMatch && actualKeys.every(function (k) { return actual[k] === expected[k] })
  var ok = keysMatch && valuesMatch
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label + ' -> ' + JSON.stringify(actual) + (ok ? '' : ' (expected ' + JSON.stringify(expected) + ', order-independent compare)'))
  if (ok) pass++; else fail++
}

function extractScriptBody_(html) {
  var m = html.match(/<script>([\s\S]*)<\/script>/)
  if (!m) throw new Error('scriptタグが見つかりません')
  return m[1]
}

/**
 *  js_shift.htmlからbuildEmployeeHasEntryMap_・buildDisplayedEmployees_の本体だけを
 *  抜き出し、テスト用のemployees配列と一緒にvmコンテキストへ読み込む。他の関数（DOM操作を伴う
 *  renderEmployeeRows等）はこのテストの対象外なので読み込まない
 */
function loadDisplayFunctions_(employeesList) {
  var jsShiftFullScript = fs.readFileSync(path.join(APP_DIR, 'js_shift.html'), 'utf8')
  var jsShiftScript = extractScriptBody_(jsShiftFullScript)

  var hasEntryMapMatch = jsShiftScript.match(/function buildEmployeeHasEntryMap_\(entriesByEmployee, wishesByEmployee\) \{[\s\S]*?\n      \}/)
  if (!hasEntryMapMatch) throw new Error('js_shift.htmlのbuildEmployeeHasEntryMap_が見つかりません')
  var displayedMatch = jsShiftScript.match(/function buildDisplayedEmployees_\(hasEntryMap\) \{[\s\S]*?\n      \}/)
  if (!displayedMatch) throw new Error('js_shift.htmlのbuildDisplayedEmployees_が見つかりません')

  var sandbox = { console: console, employees: employeesList }
  vm.createContext(sandbox)
  vm.runInContext(hasEntryMapMatch[0] + '\n' + displayedMatch[0], sandbox, { filename: 'js_shift.html (display functions)' })
  return sandbox
}

function empIds_(list) {
  return list.map(function (e) { return e.id })
}

console.log('検証対象: js_shift.htmlのbuildEmployeeHasEntryMap_・buildDisplayedEmployees_（本番関数をそのまま実行）')
console.log('---')

// ------------------------------------------------------------------
// 1. 0人：employeesが空配列でも例外にならず、空配列を返す
// ------------------------------------------------------------------
{
  var env1 = loadDisplayFunctions_([])
  var hasEntry1 = env1.buildEmployeeHasEntryMap_({}, {})
  var displayList1 = env1.buildDisplayedEmployees_(hasEntry1)
  assertEqual(displayList1, [], '1. 従業員0人のとき、表示対象リストは空配列')
}

// ------------------------------------------------------------------
// 2. 6人、全員に希望または勤務がある：全員が表示対象になり、元の並び順のまま
// ------------------------------------------------------------------
{
  var employees6 = [1, 2, 3, 4, 5, 6].map(function (n) { return { id: n, display_name: '従業員' + n } })
  var env2 = loadDisplayFunctions_(employees6)
  var entries2 = { '1': [{}], '3': [{}], '5': [{}] } // 奇数IDは勤務あり
  var wishes2 = { '2': [{}], '4': [{}], '6': [{}] } // 偶数IDは希望あり
  var hasEntry2 = env2.buildEmployeeHasEntryMap_(entries2, wishes2)
  var displayList2 = env2.buildDisplayedEmployees_(hasEntry2)
  assertEqual(empIds_(displayList2), [1, 2, 3, 4, 5, 6], '2. 6人全員に希望または勤務があるとき、全員が表示対象になり元のID順（1〜6）のまま並ぶ')
}

// ------------------------------------------------------------------
// 3. 8人中4人だけに希望/勤務あり：ある人だけが元の順序のまま残り、ない人は表示対象から消える
// ------------------------------------------------------------------
{
  var employees8 = [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) { return { id: n, display_name: '従業員' + n } })
  var env3 = loadDisplayFunctions_(employees8)
  // ID 2,5,7に勤務あり、ID 4に希望あり。他（1,3,6,8）はどちらもなし
  var entries3 = { '2': [{}], '5': [{}], '7': [{}] }
  var wishes3 = { '4': [{}] }
  var hasEntry3 = env3.buildEmployeeHasEntryMap_(entries3, wishes3)
  var displayList3 = env3.buildDisplayedEmployees_(hasEntry3)
  assertEqual(empIds_(displayList3), [2, 4, 5, 7], '3. 8人中4人に希望/勤務ありのとき、表示対象はその4人だけで元順（2,4,5,7）のまま')
  assertEqual(displayList3.length, 4, '3. 表示対象リストの人数は希望/勤務がある人数と一致する（絞り込みが行われる）')
}

// ------------------------------------------------------------------
// 4. 希望のみ・勤務のみ・両方あり・両方なしの4パターンが混在する場合の分類
// ------------------------------------------------------------------
{
  var employees4 = [
    { id: 'A', display_name: '希望のみ' },
    { id: 'B', display_name: '勤務のみ' },
    { id: 'C', display_name: '両方あり' },
    { id: 'D', display_name: '両方なし' }
  ]
  var env4 = loadDisplayFunctions_(employees4)
  var entries4 = { B: [{}], C: [{}] }
  var wishes4 = { A: [{}], C: [{}] }
  var hasEntry4 = env4.buildEmployeeHasEntryMap_(entries4, wishes4)
  assertObjectEqual(hasEntry4, { A: true, B: true, C: true }, '4. hasEntryマップは希望のみ・勤務のみ・両方ありの3人がtrue、両方なしのDは含まれない')
  var displayList4 = env4.buildDisplayedEmployees_(hasEntry4)
  assertEqual(empIds_(displayList4), ['A', 'B', 'C'], '4. 希望のみ/勤務のみ/両方ありの3人（元順A,B,C）だけが表示対象になり、両方なしのDは表から消える')
}

// ------------------------------------------------------------------
// 5. 希望なしで直接登録した勤務も表示対象に含まれる（希望が存在しなくても勤務だけでtrueになる）
// ------------------------------------------------------------------
{
  var employees1 = [{ id: 'X', display_name: '直接登録' }]
  var env5 = loadDisplayFunctions_(employees1)
  var hasEntry5 = env5.buildEmployeeHasEntryMap_({ X: [{ source_row: 5 }] }, {}) // wishesは空（希望なし）
  assertObjectEqual(hasEntry5, { X: true }, '5. 希望なしで直接登録した勤務だけでもhasEntryはtrueになる')
  var displayList5 = env5.buildDisplayedEmployees_(hasEntry5)
  assertEqual(empIds_(displayList5), ['X'], '5. 希望なし直接登録の従業員も表示対象に現れる')
}

// ------------------------------------------------------------------
// 6. 空配列（該当従業員のentries/wishesが[]）はhasEntryをtrueにしない
//    （サーバー側がキー自体を返す実装でも、配列が空なら「なし」として扱う防御を確認）
// ------------------------------------------------------------------
{
  var employees1b = [{ id: 'Y', display_name: 'キーはあるが空配列' }]
  var env6 = loadDisplayFunctions_(employees1b)
  var hasEntry6 = env6.buildEmployeeHasEntryMap_({ Y: [] }, { Y: [] })
  assertObjectEqual(hasEntry6, {}, '6. entries/wishesのキーが存在しても配列が空ならhasEntryはtrueにならない')
  var displayList6 = env6.buildDisplayedEmployees_(hasEntry6)
  assertEqual(empIds_(displayList6), [], '6. 空配列だけの従業員は表示対象から外れる（表から消える）')
}

// ------------------------------------------------------------------
// 7. 従業員の元データ（employees配列）が破壊的に変更されないこと
// ------------------------------------------------------------------
{
  var employeesOrig = [
    { id: 1, display_name: 'あり' },
    { id: 2, display_name: 'なし' }
  ]
  var employeesSnapshotJson = JSON.stringify(employeesOrig)
  var env7 = loadDisplayFunctions_(employeesOrig)
  var hasEntry7 = env7.buildEmployeeHasEntryMap_({ '1': [{}] }, {})
  env7.buildDisplayedEmployees_(hasEntry7)
  assertEqual(JSON.stringify(employeesOrig), employeesSnapshotJson, '7. buildDisplayedEmployees_を呼んでも元のemployees配列の内容・順序は変化しない（非破壊）')
}

// ------------------------------------------------------------------
// 8. 表示対象の要素は従業員オブジェクト自体（id・display_name）と同一参照
//    （renderEmployeeRows側はこのオブジェクトのemp.idでバー・編集対象と対応付けるため、
//    参照の同一性が崩れていないことが重要）
// ------------------------------------------------------------------
{
  var empA = { id: 'A', display_name: 'Aさん' }
  var empB = { id: 'B', display_name: 'Bさん' }
  var env8 = loadDisplayFunctions_([empA, empB])
  var hasEntry8 = env8.buildEmployeeHasEntryMap_({}, { B: [{}] })
  var displayList8 = env8.buildDisplayedEmployees_(hasEntry8)
  assertEqual(displayList8.length, 1, '8. Aは希望/勤務なしのため表示対象は1人だけ')
  assertTrue(displayList8[0] === empB, '8. 表示対象の要素は元のempBオブジェクトと同一参照（display_name等が複製されず保たれる）')
}

// ------------------------------------------------------------------
// 9. 希望から勤務への登録だけでは、hasEntryの判定結果（表示対象か）が変わらないことを確認する
//    （希望が消費されwishesから消えても、新規に勤務がentriesへ入るため、hasEntryは
//    「希望あり→勤務あり」の間もtrueのまま。行の出現・消失が余計に起きないことの根拠になる）
// ------------------------------------------------------------------
{
  var employees1c = [{ id: 'Z', display_name: '希望から勤務' }]
  var env9 = loadDisplayFunctions_(employees1c)
  // 登録前：希望のみ
  var beforeHasEntry = env9.buildEmployeeHasEntryMap_({}, { Z: [{ wish_id: 'w1' }] })
  assertObjectEqual(beforeHasEntry, { Z: true }, '9a. 希望のみの時点でhasEntryはtrue（表示対象）')
  // 希望から勤務登録後：希望は消費されて消え、勤務のみになる
  var afterHasEntry = env9.buildEmployeeHasEntryMap_({ Z: [{ source_row: 10, wish_id: 'w1' }] }, {})
  assertObjectEqual(afterHasEntry, { Z: true }, '9b. 希望から勤務へ登録した後もhasEntryはtrueのまま（表示対象に留まり、行が消えたり動いたりしない）')
}

// ------------------------------------------------------------------
// 10. 最後の希望・勤務を削除すると、その従業員は表示対象から消える
// ------------------------------------------------------------------
{
  var employees1d = [{ id: 'W', display_name: '最後の勤務を削除' }]
  var env10 = loadDisplayFunctions_(employees1d)
  var beforeDelete = env10.buildEmployeeHasEntryMap_({ W: [{ source_row: 1 }] }, {})
  assertObjectEqual(beforeDelete, { W: true }, '10a. 勤務がある時点ではhasEntryはtrue')
  assertEqual(empIds_(env10.buildDisplayedEmployees_(beforeDelete)), ['W'], '10a. 表示対象に含まれる')
  // 削除後：entries/wishesとも空
  var afterDelete = env10.buildEmployeeHasEntryMap_({}, {})
  assertObjectEqual(afterDelete, {}, '10b. 最後の勤務を削除した後、hasEntryは空になる')
  assertEqual(empIds_(env10.buildDisplayedEmployees_(afterDelete)), [], '10b. 表示対象からWが消える（表から消える）')
}

// ------------------------------------------------------------------
// 11. renderEmployeeRows全体（DOM生成）を、本番のjs_shift.htmlからそのまま実行し、
//     実際に生成される行が「希望または勤務がある人」だけに絞られ、各行のバーのdata属性
//     （employeeId等）が崩れていないことを確認する。戻り値（表示した従業員数）も検証する。
//     フェイクDOMは最小限（createElement/appendChild/dataset/style/getElementById）だけを再現し、
//     行の絞り込み・バーとの対応というロジックそのものをテスト側で再実装しない
// ------------------------------------------------------------------
function createFakeDomElement_() {
  var el = {
    className: '',
    textContent: '',
    title: '',
    type: '',
    style: {},
    dataset: {},
    children: [],
    _attrs: {},
    appendChild: function (child) { this.children.push(child) },
    setAttribute: function (name, value) { this._attrs[name] = value },
    addEventListener: function () {}
  }
  return el
}

function renderEmployeeRowsWithFakeDom_(employeesList, shiftEntries, wishEntries) {
  var jsShiftFullScript = fs.readFileSync(path.join(APP_DIR, 'js_shift.html'), 'utf8')
  var jsShiftScript = extractScriptBody_(jsShiftFullScript)

  var hasEntryMapMatch = jsShiftScript.match(/function buildEmployeeHasEntryMap_\(entriesByEmployee, wishesByEmployee\) \{[\s\S]*?\n      \}/)
  var displayedMatch = jsShiftScript.match(/function buildDisplayedEmployees_\(hasEntryMap\) \{[\s\S]*?\n      \}/)
  var renderRowsMatch = jsShiftScript.match(/function renderEmployeeRows\(shiftEntries, wishEntries\) \{[\s\S]*?\n      \}/)
  if (!hasEntryMapMatch || !displayedMatch || !renderRowsMatch) throw new Error('js_shift.htmlから必要な関数を抽出できませんでした')

  var timelineBody = createFakeDomElement_()
  timelineBody.innerHTML = ''
  var fakeDocument = {
    getElementById: function (id) {
      if (id === 'timeline_body') return timelineBody
      return null
    },
    createElement: function () { return createFakeDomElement_() }
  }

  var sandbox = {
    console: console,
    employees: employeesList,
    document: fakeDocument,
    // renderEmployeeRowsはバー生成時にクリックハンドラを登録するが、fakeDocumentの
    // addEventListenerはno-opのため実際には呼ばれない。関数の存在チェック（参照エラー回避）
    // のためだけにダミーを与える（このテストの対象はDOM生成・絞り込み・data属性であり、
    // クリック時の挙動はhandleShiftBarClick_等を検証する既存テストの範囲）
    handleShiftBarClick_: function () {},
    handleShiftWishBarClick_: function () {}
  }
  vm.createContext(sandbox)
  vm.runInContext(hasEntryMapMatch[0] + '\n' + displayedMatch[0] + '\n' + renderRowsMatch[0], sandbox, { filename: 'js_shift.html (renderEmployeeRows)' })
  var displayedCount = sandbox.renderEmployeeRows(shiftEntries, wishEntries)
  return { body: timelineBody, displayedCount: displayedCount }
}

{
  var employees11 = [
    { id: 1, display_name: 'なし1' },
    { id: 2, display_name: 'あり(勤務)' },
    { id: 3, display_name: 'なし2' },
    { id: 4, display_name: 'あり(希望)' }
  ]
  var shiftEntries11 = [
    { employee_id: '2', source_row: 5, start_ms: 1000, end_ms: 2000, offset_minutes: 0, display_minutes: 60, start_label: '11:00', end_label: '12:00', wish_id: '' }
  ]
  var wishEntries11 = [
    { employee_id: '4', wish_id: 'w1', start_ms: 3000, end_ms: 4000, offset_minutes: 60, display_minutes: 120, start_label: '12:00', end_label: '14:00' }
  ]
  var result11 = renderEmployeeRowsWithFakeDom_(employees11, shiftEntries11, wishEntries11)
  var body11 = result11.body
  assertEqual(result11.displayedCount, 2, '11. renderEmployeeRowsの戻り値は実際に表示した従業員数（4人中2人）と一致する')
  assertEqual(body11.children.length, 2, '11. renderEmployeeRows実行後、timeline_bodyの行数は希望/勤務がある2人だけになる（「なし1」「なし2」は描画されない）')
  var rowNames11 = body11.children.map(function (row) { return row.children[0].textContent })
  assertEqual(rowNames11, ['あり(勤務)', 'あり(希望)'], '11. 実際に生成された行は希望/勤務がある人（元順どおり あり(勤務)→あり(希望)）だけ')

  // 1行目（あり(勤務)）のtrack内に、勤務バーが1件あり、そのdata-employee-idが従業員2と一致すること
  var row0Track = body11.children[0].children[1]
  assertEqual(row0Track.children.length, 1, '11. 「あり(勤務)」の行には勤務バーが1件だけ生成される（希望バーは含まれない）')
  assertEqual(row0Track.children[0].dataset.employeeId, '2', '11. 勤務バーのdataset.employeeIdは元のshiftEntries[0].employee_idと一致する（絞り込み後も対応は崩れない）')

  // 2行目（あり(希望)）のtrack内に、希望バーが1件あり、そのdata-wishIdが一致すること
  var row1Track = body11.children[1].children[1]
  assertEqual(row1Track.children.length, 1, '11. 「あり(希望)」の行には希望バーが1件だけ生成される')
  assertEqual(row1Track.children[0].dataset.wishId, 'w1', '11. 希望バーのdataset.wishIdは元のwishEntries[0].wish_idと一致する')
  assertEqual(row1Track.children[0].className, 'timeline-bar timeline-bar--wish', '11. 希望バーは薄色クラス（timeline-bar--wish）を持つ')
}

// ------------------------------------------------------------------
// 11b. 従業員希望シフト一括提出（2026-09-21）：期限後（after_deadline=true）の希望だけが
//      薄い赤クラス（timeline-bar--wish-overdue）を追加で持つ。期限内（after_deadline=false）は
//      従来どおりtimeline-bar--wishのみで、文言（textContent）はどちらも変わらない
//      （バーへ「期限後」という文字を足さない要件の確認）
// ------------------------------------------------------------------
{
  var employees11b = [{ id: 1, display_name: '期限後太郎' }, { id: 2, display_name: '期限内花子' }]
  var wishEntries11b = [
    { employee_id: '1', wish_id: 'w-overdue', start_ms: 1000, end_ms: 2000, offset_minutes: 0, display_minutes: 60, start_label: '11:00', end_label: '12:00', after_deadline: true },
    { employee_id: '2', wish_id: 'w-ontime', start_ms: 1000, end_ms: 2000, offset_minutes: 0, display_minutes: 60, start_label: '11:00', end_label: '12:00', after_deadline: false }
  ]
  var result11b = renderEmployeeRowsWithFakeDom_(employees11b, [], wishEntries11b)
  var overdueBar = result11b.body.children[0].children[1].children[0]
  var ontimeBar = result11b.body.children[1].children[1].children[0]
  assertEqual(overdueBar.className, 'timeline-bar timeline-bar--wish timeline-bar--wish-overdue', '11b. 期限後の希望バーはtimeline-bar--wish-overdueクラスを追加で持つ')
  assertEqual(overdueBar.textContent, '希望 11:00〜12:00', '11b. 期限後でも文言は「希望」＋時刻表記のまま（「期限後」の文字を足さない）')
  assertEqual(ontimeBar.className, 'timeline-bar timeline-bar--wish', '11b. 期限内の希望バーは従来どおりtimeline-bar--wish-overdueを持たない')
}

// ------------------------------------------------------------------
// 12. 0人：希望・勤務が誰にもない場合、renderEmployeeRowsは0行を描画し、戻り値も0になる
//     （呼び出し元のrenderIfBothTimelineResultsReady_はこの戻り値で0人案内の表示要否を判定する。
//     通信中・通信失敗のメッセージと混同しないことはjs_shift.html側の設計であり、この関数自体は
//     「実際に描画できた人数」を返すだけの責務にとどめている）
// ------------------------------------------------------------------
{
  var employees12 = [
    { id: 1, display_name: '希望も勤務もない1' },
    { id: 2, display_name: '希望も勤務もない2' }
  ]
  var result12 = renderEmployeeRowsWithFakeDom_(employees12, [], [])
  assertEqual(result12.displayedCount, 0, '12. 全員に希望も勤務もないとき、戻り値は0人')
  assertEqual(result12.body.children.length, 0, '12. 全員に希望も勤務もないとき、timeline_bodyには行が1つも生成されない')
}

console.log('---')
console.log('【ブラウザ・GAS実機確認が必要】このテストでは検証できない範囲:')
console.log('- 実際のブラウザDOM・CSSでの見た目（行の背景色・バーの位置・氏名列の折り返し・0人時の案内文の見た目）')
console.log('- 別営業日に切り替えた際、古い営業日の希望・勤務データが分類に混入しないこと')
console.log('  （refreshTimelineのrequestId/requestedBusinessDateガードは既存のまま、日付変更のたびに')
console.log('  サーバーから取り直したshiftEntries/wishEntriesだけを使うため理論上は混入しないが、')
console.log('  実際のブラウザでの日付連打・通信タイミングでの確認はしていない）')
console.log('- 登録・変更・削除後、実際に画面上で対象者が正しく表に現れたり消えたりすること')
console.log('- 通信中・通信失敗のメッセージと0人案内メッセージが、実際の画面で意図通り切り替わること')
console.log('- 0人のとき、希望追加・直接登録のボタンが実際に操作可能であること（disabled化されていないこと）')
console.log('- 表から消えた従業員も「直接シフトを登録」のselect（shift_employee_select）で引き続き選べること')
console.log('  （selectはサーバー側テンプレートでemployees全件から独立生成されているため理論上は影響を受けないが、実機未確認）')
console.log('- スクロールで画面外に隠れた従業員の勤務も、判定・休憩候補の計算に含まれること')
console.log('  （judgeShiftsForDate等のサーバー側判定はtimeline_bodyのDOMに依存しないため理論上問題ないが、')
console.log('  実機で件数の一致までは確認していない）')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
