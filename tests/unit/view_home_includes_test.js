// ステージ3（view_home.htmlのインラインJavaScriptをjs_home_common.html・js_shift.html・
// js_judge.html・js_home_controller.htmlの4ファイルへ分割）の実機不具合修正への対応。
//
// 不具合の経緯: 当初、4つの部分ファイルは<script>タグを持たない生JavaScriptのみで構成し、
// view_home.html側で1つの<script>...</script>の中に4つのincludeをまとめていた。しかし
// HtmlService.createHtmlOutputFromFileは単独のHTMLファイルとして読み込む際に中身をHTML
// エスケープするため、生JavaScriptの"<"が"&lt;"へ壊れ、ブラウザで構文エラーになった。
// 対応として、部分ファイルそれぞれを1組の<script>〜</script>で囲み、view_home.html側は
// 外側の<script>を持たず、includeをそのまま並べる（展開後は独立した通常の<script>要素になる）
// 構造へ変更した。
//
// このテストでは、部分ファイルが「<script>で始まり</script>で終わるHTML断片」であることと、
// タグを取り除いた中身が比較対象スナップショットと一字一句変わっていないことを、
// 本番の app/ 内ファイルを直接読み込んで検証する。テスト側に本番のロジック・処理を再実装しない。
//
// 比較対象スナップショットは「希望シフトのバーから勤務を登録する」機能追加（2026-09-15）を境に
// app_分割前スナップショット/stage4_希望シフト機能追加前へ更新した。それ以前はステージ2c
// （ファイル分割自体の無変更性を証明する版）と比較していたが、今回の機能追加で
// js_shift_wish.htmlの新設・多数の関数/共有変数の追加・既存関数の書き換えが発生し、
// 個別の除外リストでは対応しきれない規模になったため、比較基準を「直前の安定版」へ進めた
// （このテストの目的である「部分ファイル分割構造そのものの整合性」を、今後もこの新基準に対して
// 検証し続ける）。
//
// 実行: node view_home_includes_test.js
// 失敗時は終了コード1で終わる。

'use strict'

var fs = require('fs')
var path = require('path')
var vm = require('vm')

var APP_DIR = path.join(__dirname, '..', '..', 'src')
var VIEW_HOME_PATH = path.join(APP_DIR, 'view_home.html')
var SNAPSHOT_DIR = path.join(__dirname, '..', 'fixtures', 'pre-shift-wish')
var SNAPSHOT_VIEW_HOME_PATH = path.join(SNAPSHOT_DIR, 'view_home.html')

var PARTIAL_NAMES_IN_EXPECTED_ORDER = ['js_home_common', 'js_shift', 'js_shift_wish', 'js_judge', 'js_home_controller']
var SNAPSHOT_PARTIAL_NAMES_IN_ORDER = ['js_home_common', 'js_shift', 'js_judge', 'js_home_controller']

var pass = 0, fail = 0
function assertTrue(actual, label) {
  var ok = !!actual
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label)
  if (ok) pass++; else fail++
}
function assertEqual(actual, expected, label) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label + ' -> ' + JSON.stringify(actual) + (ok ? '' : ' (expected ' + JSON.stringify(expected) + ')'))
  if (ok) pass++; else fail++
}

// 末尾が「_」ではない/ある、いずれも含む現行クライアント関数の想定一覧（include順）
var EXPECTED_CLIENT_FUNCTIONS = [
  'preventFormSubmit', 'pad2_', 'formatDateInputValue_', 'parseLocalDateStr_',
  'formatBusinessDateHeaderLabel_', 'syncNavDisplay', 'updateShiftMessage',
  'updateBusinessDayTypeDisplay_', 'updateActionButtonsEnabled_', 'updateTimelineMessage',
  'updateJudgeMessage',
  'handleShiftFormSubmit', 'openShiftDirectAddModal_', 'closeShiftDirectAddModal_',
  'resetShiftSkillToggle_', 'toggleShiftSkillCard_',
  'handleShiftDirectAddOverlayClick_', 'clearSkillCard_', 'addSkillCardText_',
  'handleShiftEmployeeChange', 'updateEmployeeSkillCard_', 'renderTimelineHeader',
  'renderIfBothTimelineResultsReady_', 'refreshTimeline',
  'buildEmployeeHasEntryMap_', 'buildDisplayedEmployees_', 'renderEmployeeRows',
  'msToTimeInputValue_', 'setShiftEditButtonsDisabled_', 'updateShiftEditModalMessage_',
  'clearShiftEditModalFields_',
  // レビュー対応（希望シフトモーダルへのマイスターラベル追加 2026-09-16）：従業員名横の
  // マイスターラベル表示ロジックをshift_edit_modal・shift_wish_modalの共通関数へ切り出した
  // （createSkillTagUI_・clearSkillTags_・createSkillTagEl_・renderSkillTags_・
  // recalculateSkillInlineVisibility_・toggleSkillDetail_・startSkillResizeWatch_・
  // stopSkillResizeWatch_）。既存のclearShiftEditSkillTags_等は、その薄いラッパーとして残す
  'createSkillTagUI_', 'clearSkillTags_', 'createSkillTagEl_', 'renderSkillTags_',
  // レビュー対応（ラベルの幅計測に関するレビュー指摘 2026-09-21）：「＋N件」ボタンの
  // 表示有無で計測すべき幅が変わる問題を修正するにあたり、幅計測部分を
  // measureVisibleSkillTagCount_として切り出した（recalculateSkillInlineVisibility_から
  // 2段階で呼ばれる）
  'recalculateSkillInlineVisibility_', 'measureVisibleSkillTagCount_', 'toggleSkillDetail_',
  'startSkillResizeWatch_', 'stopSkillResizeWatch_',
  'clearShiftEditSkillTags_',
  'renderShiftEditSkillTags_', 'recalculateShiftEditSkillInlineVisibility_',
  'toggleShiftEditSkillDetail_',
  'startShiftEditSkillResizeWatch_', 'stopShiftEditSkillResizeWatch_',
  'openShiftEditModal_', 'closeShiftEditModal_',
  'handleShiftEditOverlayClick_', 'handleShiftBarClick_', 'handleShiftEditSave_',
  'handleShiftEditDelete_',
  'toggleShiftWishSkillDetail_',
  'setShiftWishModalButtonsDisabled_',
  'updateShiftWishModalMessage_', 'applyShiftWishNormalMode_',
  'handleShiftWishBarClick_', 'closeShiftWishModal_', 'handleShiftWishOverlayClick_',
  'handleShiftWishRegisterShift_',
  'handleJudgeClick', 'clearJudgeResults', 'resetJudgeFilterState_', 'classifyJudgeSlot_',
  'countJudgeSlotsByFilter_', 'decideInitialJudgeFilter_', 'renderJudgeFilterButtons_',
  'openJudgeDetailModal_', 'closeJudgeDetailModal_', 'handleOpenJudgeDetailClick_',
  'handleJudgeDetailOverlayClick_', 'buildJudgeRowDisplay_', 'renderJudgeResults',
  'renderJudgeSummary_', 'renderJudgeResultTable_', 'clearBreakResults_', 'renderBreakResults_',
  'goToPreviousDay', 'goToNextDay', 'goToToday', 'handleBusinessDateInputChange',
  'onBusinessDateChanged', 'refreshBusinessDayType'
]

// 現行のトップレベル共有変数の想定一覧
var EXPECTED_SHARED_VARS = [
  'WEEKDAY_LABELS_', 'currentBusinessDate', 'currentDayType', 'timelineRequestSequence',
  'judgeRequestSequence', 'businessDayTypeRequestSequence', 'businessDayTypeReady',
  'timelinePendingShiftEntries_', 'timelinePendingWishEntries_',
  'shiftEditContext', 'shiftEditTriggerEl', 'shiftEditRequestInProgress',
  // レビュー対応（希望シフトモーダルへのマイスターラベル追加 2026-09-16）：shiftEditSkillMeisters_・
  // shiftEditSkillResizeHandler_はcreateSkillTagUI_が返すオブジェクト（ui.meisters・
  // ui.resizeHandler）へ吸収され、トップレベル変数としては存在しなくなった。代わりに
  // shiftEditSkillTagUI_・shiftWishSkillTagUI_（それぞれのUIインスタンス自体）が増えている
  'shiftEditSkillTagUI_',
  'shiftWishContext', 'shiftWishTriggerEl',
  'shiftWishRequestInProgress', 'shiftWishSkillTagUI_',
  'currentJudgeFilter_', 'currentJudgeSlots_', 'JUDGE_FILTER_DEFS_',
  'judgeDetailModalTriggerEl', 'JUDGE_DETAIL_MODAL_OPEN_BODY_CLASS_'
]

console.log('検証対象: ' + VIEW_HOME_PATH)
console.log('           ' + PARTIAL_NAMES_IN_EXPECTED_ORDER.map(function (n) { return n + '.html' }).join(', '))
console.log('比較対象（機能追加前スナップショット）: ' + SNAPSHOT_VIEW_HOME_PATH)
console.log('---')

// ------------------------------------------------------------------
// 1〜3. view_home.htmlのinclude構造（一意性・順序・想定外includeの不在）
// ------------------------------------------------------------------

var viewHomeSource = fs.readFileSync(VIEW_HOME_PATH, 'utf8')

// <head>〜</head>だけを対象にする。body内にはemployees/maisterSummariesを渡す既存の
// <script>があり、head内の構造検証（外側scriptタグの不在）に無関係のため混ぜない
var headMatch = viewHomeSource.match(/<head>([\s\S]*?)<\/head>/i)
assertTrue(!!headMatch, '前提: view_home.htmlから<head>〜</head>を抽出できた')
var viewHomeHeadSource = headMatch ? headMatch[1] : ''

// <?!= HtmlService.createHtmlOutputFromFile('js_xxx').getContent(); ?> 形式のincludeを
// 出現順のまま抽出する（js_で始まるファイル名だけを対象にする）。引用符は単一引用符・
// 二重引用符のどちらでも拾う（想定外includeの検出を引用符の書き方で回避できないようにする）
var includeRe = /HtmlService\.createHtmlOutputFromFile\(\s*(['"])(js_[A-Za-z0-9_]+)\1\s*\)\.getContent\(\)/g
var foundIncludes = []
var im
while ((im = includeRe.exec(viewHomeHeadSource)) !== null) {
  foundIncludes.push(im[2])
}

for (var i = 0; i < PARTIAL_NAMES_IN_EXPECTED_ORDER.length; i++) {
  var name = PARTIAL_NAMES_IN_EXPECTED_ORDER[i]
  var count = foundIncludes.filter(function (n) { return n === name }).length
  assertEqual(count, 1, '1. view_home.htmlが' + name + 'をちょうど1回includeしている')
}

assertEqual(foundIncludes, PARTIAL_NAMES_IN_EXPECTED_ORDER, '2. include順がjs_home_common→js_shift→js_shift_wish→js_judge→js_home_controllerの順と完全一致する')

var unexpectedIncludes = foundIncludes.filter(function (n) { return PARTIAL_NAMES_IN_EXPECTED_ORDER.indexOf(n) === -1 })
assertEqual(unexpectedIncludes, [], '3. js_で始まる想定外のincludeがない')

// ------------------------------------------------------------------
// 3b. view_home.htmlの<head>内に、テンプレートソース上へ直接書かれた開始<script>・
//     終了</script>がどちらも0個であること（4つのincludeが外側の<script>〜</script>で
//     再びまとめられていないことの確認。これがないと、不具合を再発させる
//     「<script>…4つのinclude…</script>」構造でも旧テストは通ってしまう）
// ------------------------------------------------------------------

var headScriptOpenMatches = viewHomeHeadSource.match(/<script(\s[^>]*)?>/gi) || []
var headScriptCloseMatches = viewHomeHeadSource.match(/<\/script>/gi) || []
assertEqual(headScriptOpenMatches.length, 0, '3b. view_home.htmlの<head>内に、テンプレートソース上へ直接書かれた開始<script>が0個である（外側scriptタグで囲み直されていない）')
assertEqual(headScriptCloseMatches.length, 0, '3b. view_home.htmlの<head>内に、テンプレートソース上へ直接書かれた終了</script>が0個である（外側scriptタグで囲み直されていない）')

// ------------------------------------------------------------------
// 4. 4つの部分ファイルがすべて実在する
// ------------------------------------------------------------------

var partialPaths = {}
for (var j = 0; j < PARTIAL_NAMES_IN_EXPECTED_ORDER.length; j++) {
  var pname = PARTIAL_NAMES_IN_EXPECTED_ORDER[j]
  var ppath = path.join(APP_DIR, pname + '.html')
  partialPaths[pname] = ppath
  assertTrue(fs.existsSync(ppath), '4. ' + pname + '.htmlが実在する')
}

var partialSources = {}
for (var k = 0; k < PARTIAL_NAMES_IN_EXPECTED_ORDER.length; k++) {
  var kname = PARTIAL_NAMES_IN_EXPECTED_ORDER[k]
  partialSources[kname] = fs.readFileSync(partialPaths[kname], 'utf8')
}

// ------------------------------------------------------------------
// 5. 各部分ファイルは、開始<script>1個・終了</script>1個をちょうど持ち、
//    それがファイル全体の外枠になっていて、タグの中に<?/?>を含まないこと。
//    ここから各ファイルのJavaScript本体（scriptタグの中身）を取り出す
// ------------------------------------------------------------------

var partialJsBodies = {}

for (var l = 0; l < PARTIAL_NAMES_IN_EXPECTED_ORDER.length; l++) {
  var lname = PARTIAL_NAMES_IN_EXPECTED_ORDER[l]
  var lsrc = partialSources[lname]

  var openMatches = lsrc.match(/<script(\s[^>]*)?>/gi) || []
  var closeMatches = lsrc.match(/<\/script>/gi) || []
  assertEqual(openMatches.length, 1, '5. ' + lname + '.htmlに開始<script>がちょうど1個ある')
  assertEqual(closeMatches.length, 1, '5. ' + lname + '.htmlに終了</script>がちょうど1個ある')

  var trimmed = lsrc.replace(/^\s+|\s+$/g, '')
  var startsWithScript = /^<script(\s[^>]*)?>/i.test(trimmed)
  var endsWithScript = /<\/script>$/i.test(trimmed)
  assertTrue(startsWithScript && endsWithScript, '5. ' + lname + '.htmlは前後の空白を除くと<script>で始まり</script>で終わる（scriptタグがファイル全体の外枠になっている）')

  var openTagMatch = lsrc.match(/<script(\s[^>]*)?>/i)
  var closeTagIndex = lsrc.search(/<\/script>/i)
  var innerJs = ''
  if (openTagMatch && closeTagIndex !== -1) {
    var openEnd = openTagMatch.index + openTagMatch[0].length
    innerJs = lsrc.slice(openEnd, closeTagIndex)
  }
  partialJsBodies[lname] = innerJs

  var hasGasTemplateTokens = /<\?|\?>/.test(innerJs)
  assertTrue(!hasGasTemplateTokens, '5. ' + lname + '.htmlのscriptタグ内に<?または?>が含まれない')
}

// ------------------------------------------------------------------
// 6〜7. 取り出したJavaScript本体を実際のinclude順で連結し、構文解析できる／
//       document・windowの最小スタブでVM評価できる
// ------------------------------------------------------------------

var concatenatedSource = foundIncludes.map(function (n) { return partialJsBodies[n] || '' }).join('\n')

var syntaxOk = true
var syntaxError = null
try {
  new vm.Script(concatenatedSource, { filename: 'view_home_includes_concatenated.js' })
} catch (e) {
  syntaxOk = false
  syntaxError = e
}
assertTrue(syntaxOk, '6. 4ファイルから取り出したJavaScriptをinclude順で連結したコードがvm.Scriptで構文解析できる' + (syntaxError ? ' (' + syntaxError.message + ')' : ''))

/**
 *  document.getElementById等が返す、テストに必要な最小限のプロパティだけを持つダミー要素
 *  （実際のDOM描画・見た目はGAS実機でしか確認できない。ここではconcatenatedSourceの
 *  トップレベル評価がdocument/window由来のReferenceErrorで落ちないことだけを確認する）
 */
function createFakeEl_() {
  return {
    innerHTML: '',
    hidden: false,
    disabled: false,
    textContent: '',
    value: '',
    title: '',
    className: '',
    style: {},
    dataset: {},
    children: [],
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false } },
    appendChild: function (child) { this.children.push(child); return child },
    removeChild: function () {},
    setAttribute: function () {},
    addEventListener: function () {},
    querySelectorAll: function () { return [] },
    focus: function () {}
  }
}

function makeEventCollector_() {
  var calls = []
  return {
    calls: calls,
    addEventListener: function (type, handler) { calls.push({ type: type, handler: handler }) }
  }
}

function runConcatenated_(source, label) {
  var docCollector = makeEventCollector_()
  var winCollector = makeEventCollector_()
  var fakeDocument = {
    addEventListener: docCollector.addEventListener,
    getElementById: function () { return createFakeEl_() },
    querySelectorAll: function () { return [] },
    createElement: function () { return createFakeEl_() },
    body: createFakeEl_()
  }
  var fakeWindow = { addEventListener: winCollector.addEventListener }
  var sandbox = {
    console: console,
    document: fakeDocument,
    window: fakeWindow,
    google: { script: { run: {} } }
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: label })
  return { sandbox: sandbox, documentCalls: docCollector.calls, windowCalls: winCollector.calls }
}

var evalOk = true
var evalError = null
var runResult = null
try {
  runResult = runConcatenated_(concatenatedSource, 'view_home_includes_concatenated.js')
} catch (e) {
  evalOk = false
  evalError = e
}
assertTrue(evalOk, '7. document/windowの最小スタブを用意した同一VMで連結コードを評価できる' + (evalError ? ' (' + evalError.message + ')' : ''))

var vmSandbox = runResult ? runResult.sandbox : {}
var documentAddEventListenerCalls = runResult ? runResult.documentCalls : []
var windowAddEventListenerCalls = runResult ? runResult.windowCalls : []

// ------------------------------------------------------------------
// 8〜10. クライアント53関数の存在・宣言数・一覧一致
// ------------------------------------------------------------------

for (var m2 = 0; m2 < EXPECTED_CLIENT_FUNCTIONS.length; m2++) {
  var fname = EXPECTED_CLIENT_FUNCTIONS[m2]
  assertTrue(typeof vmSandbox[fname] === 'function', '8. ' + fname + ' が関数として存在する')
}

function countDeclarations(fnName, source) {
  var re = new RegExp('^\\s*function ' + fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(', 'gm')
  var matches = source.match(re)
  return matches ? matches.length : 0
}

for (var n2 = 0; n2 < EXPECTED_CLIENT_FUNCTIONS.length; n2++) {
  var dname = EXPECTED_CLIENT_FUNCTIONS[n2]
  var declCount = countDeclarations(dname, concatenatedSource)
  assertEqual(declCount, 1, '9. ' + dname + ' の宣言がちょうど1回だけ存在する')
}

var allFunctionDeclRe = /^\s*function ([A-Za-z0-9_]+)\s*\(/gm
var allDeclaredNames = []
var dm
while ((dm = allFunctionDeclRe.exec(concatenatedSource)) !== null) {
  allDeclaredNames.push(dm[1])
}
var uniqueDeclaredNames = allDeclaredNames.filter(function (n, idx) { return allDeclaredNames.indexOf(n) === idx }).sort()
var expectedSorted = EXPECTED_CLIENT_FUNCTIONS.slice().sort()

assertEqual(uniqueDeclaredNames, expectedSorted, '10. クライアント関数一覧が固定リスト' + EXPECTED_CLIENT_FUNCTIONS.length + '個と完全一致する（想定外の追加・欠落・重複がない）')

// 共有変数の宣言存在確認（値の比較だけでは、初期値がundefinedの変数（currentBusinessDate等）の
// 宣言そのものが削除されていても検知できないため、ソース上の宣言数とVM上のプロパティ存在を
// 別々に確認する）
// トップレベルの宣言だけを対象にする（本番コードは6スペースインデントをトップレベルの
// 規約にしており、関数内のローカルvar（var i、var el等）はそれより深いインデントになる。
// 関数宣言の抽出（EXPECTED_CLIENT_FUNCTIONS）と同じ考え方で、共有変数側もトップレベルだけを拾う）
var TOP_LEVEL_INDENT = '      '
function countVarDeclarations(varName, source) {
  var re = new RegExp('^' + TOP_LEVEL_INDENT + 'var\\s+' + varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9_$])', 'gm')
  var matches = source.match(re)
  return matches ? matches.length : 0
}

var newVarDeclMismatches = []
for (var r2 = 0; r2 < EXPECTED_SHARED_VARS.length; r2++) {
  var rvname = EXPECTED_SHARED_VARS[r2]
  var newDeclCount = countVarDeclarations(rvname, concatenatedSource)
  if (newDeclCount !== 1) newVarDeclMismatches.push(rvname + ': ' + newDeclCount)
}
assertEqual(newVarDeclMismatches, [], '分割後: 共有変数' + EXPECTED_SHARED_VARS.length + '個がそれぞれトップレベルでちょうど1回var宣言されている')

// ソース上で見つかった全トップレベルvar宣言名の一覧が、EXPECTED_SHARED_VARSと完全一致すること
// （想定外の共有変数の追加・欠落がないこと）
var allVarDeclRe = new RegExp('^' + TOP_LEVEL_INDENT + 'var\\s+([A-Za-z0-9_$]+)', 'gm')
var allDeclaredVarNames = []
var vm2
while ((vm2 = allVarDeclRe.exec(concatenatedSource)) !== null) {
  allDeclaredVarNames.push(vm2[1])
}
var uniqueDeclaredVarNames = allDeclaredVarNames.filter(function (n, idx) { return allDeclaredVarNames.indexOf(n) === idx }).sort()
var expectedVarsSorted = EXPECTED_SHARED_VARS.slice().sort()
assertEqual(uniqueDeclaredVarNames, expectedVarsSorted, '分割後: 連結ソースから抽出した共有変数名の一覧が固定リスト' + EXPECTED_SHARED_VARS.length + '個と完全一致する（想定外の追加・欠落がない）')

// 初期値がundefinedの変数（currentBusinessDate）も含め、VM上に実際に宣言として存在すること。
// Node.jsのvmモジュールは、値の代入を伴わない"var x;"をトップレベルで実行しても、
// コンテキストオブジェクトへ列挙可能プロパティとして反映しない（Object.prototype.hasOwnProperty
// やObject.keysでは見えない）という制約があるため、sandboxオブジェクト側からの存在確認では
// 判別できない。そこで、評価済みのソースコードを保持したまま同一VM内で"typeof 変数名"を
// 追加評価し、宣言が存在しない場合にReferenceErrorになることを利用して判定する
// （宣言があれば未代入でも常にstring 'undefined'が返り、例外にはならない）
function checkVarDeclaredInVm_(source, varNames, label) {
  var missing = []
  for (var i2 = 0; i2 < varNames.length; i2++) {
    var name = varNames[i2]
    var checkSandbox = { console: console, document: { addEventListener: function () {}, getElementById: function () { return {} }, querySelectorAll: function () { return [] }, createElement: function () { return {} }, body: {} }, window: { addEventListener: function () {} }, google: { script: { run: {} } } }
    vm.createContext(checkSandbox)
    try {
      vm.runInContext(source + '\n;(function(){ return typeof ' + name + '; })()', checkSandbox, { filename: label })
    } catch (e) {
      missing.push(name + ': ' + e.message)
    }
  }
  return missing
}

var newVarMissing = checkVarDeclaredInVm_(concatenatedSource, EXPECTED_SHARED_VARS, 'view_home_includes_var_check.js')
assertEqual(newVarMissing, [], '分割後: 共有変数' + EXPECTED_SHARED_VARS.length + '個すべてがVM上に宣言として存在する（初期値undefinedの変数も宣言ごと削除されていない）')

// ------------------------------------------------------------------
// 10c（機能追加前スナップショットとの構造比較）. 分割構造（<script>で始まり</script>で終わる、
// includeが1回ずつ、head内に外側scriptタグがない）が、機能追加前スナップショットでも
// 同じ形で成立していたことを確認する。関数本体の一字一句比較は行わない
// （今回の機能追加で多数の関数を意図的に書き換えたため。スナップショットとの一致を保証したいのは
// 「分割構造」であって「実装内容」ではない）
// ------------------------------------------------------------------

var snapshotViewHomeSource = fs.readFileSync(SNAPSHOT_VIEW_HOME_PATH, 'utf8')
var snapshotHeadMatch = snapshotViewHomeSource.match(/<head>([\s\S]*?)<\/head>/i)
assertTrue(!!snapshotHeadMatch, '10c. 機能追加前スナップショットのview_home.htmlから<head>〜</head>を抽出できた')
var snapshotHeadSource = snapshotHeadMatch ? snapshotHeadMatch[1] : ''

var snapshotIncludes = []
var sim
var snapshotIncludeRe = /HtmlService\.createHtmlOutputFromFile\(\s*(['"])(js_[A-Za-z0-9_]+)\1\s*\)\.getContent\(\)/g
while ((sim = snapshotIncludeRe.exec(snapshotHeadSource)) !== null) {
  snapshotIncludes.push(sim[2])
}
assertEqual(snapshotIncludes, SNAPSHOT_PARTIAL_NAMES_IN_ORDER, '10c. 機能追加前スナップショットのinclude順が想定4ファイルと完全一致する')

var snapshotPartialSources = {}
for (var sp = 0; sp < SNAPSHOT_PARTIAL_NAMES_IN_ORDER.length; sp++) {
  var spname = SNAPSHOT_PARTIAL_NAMES_IN_ORDER[sp]
  snapshotPartialSources[spname] = fs.readFileSync(path.join(SNAPSHOT_DIR, spname + '.html'), 'utf8')
}
var snapshotJsBodies = {}
for (var sq = 0; sq < SNAPSHOT_PARTIAL_NAMES_IN_ORDER.length; sq++) {
  var sqname = SNAPSHOT_PARTIAL_NAMES_IN_ORDER[sq]
  var sqsrc = snapshotPartialSources[sqname]
  var sqOpenMatch = sqsrc.match(/<script(\s[^>]*)?>/i)
  var sqCloseIndex = sqsrc.search(/<\/script>/i)
  var sqInner = ''
  if (sqOpenMatch && sqCloseIndex !== -1) {
    var sqOpenEnd = sqsrc.indexOf(sqOpenMatch[0]) + sqOpenMatch[0].length
    sqInner = sqsrc.slice(sqOpenEnd, sqCloseIndex)
  }
  assertTrue(sqInner.length > 0, '10c. 機能追加前スナップショットの' + sqname + '.htmlから<script>本体を抽出できた')
  snapshotJsBodies[sqname] = sqInner
}
var snapshotConcatenatedSource = SNAPSHOT_PARTIAL_NAMES_IN_ORDER.map(function (n) { return snapshotJsBodies[n] || '' }).join('\n')

var snapshotResult = runConcatenated_(snapshotConcatenatedSource, 'stage4_snapshot_concatenated.js')

// ------------------------------------------------------------------
// 11. documentのkeydown・windowのloadイベントがそれぞれ1件登録されること
//     （コールバック本体は今回の機能追加でモーダル種別が増えており、スナップショットとは
//     一致しなくなるため比較しない。イベント登録の存在自体だけを確認する）
// ------------------------------------------------------------------

var keydownCalls = documentAddEventListenerCalls.filter(function (c) { return c.type === 'keydown' })
var loadCalls = windowAddEventListenerCalls.filter(function (c) { return c.type === 'load' })

assertEqual(keydownCalls.length, 1, '11. document.addEventListener(\'keydown\', ...)がちょうど1回登録される')
assertEqual(loadCalls.length, 1, '11. window.addEventListener(\'load\', ...)がちょうど1回登録される')

var snapshotKeydownCalls = snapshotResult.documentCalls.filter(function (c) { return c.type === 'keydown' })
var snapshotLoadCalls = snapshotResult.windowCalls.filter(function (c) { return c.type === 'load' })
assertEqual(snapshotKeydownCalls.length, 1, '10c. 機能追加前スナップショットでもdocument.addEventListener(\'keydown\', ...)がちょうど1回登録される')
assertEqual(snapshotLoadCalls.length, 1, '10c. 機能追加前スナップショットでもwindow.addEventListener(\'load\', ...)がちょうど1回登録される')

console.log('---')
console.log('【GAS実機確認が必要】このテストでは検証できない範囲:')
console.log('- ブラウザ上での実際のUI操作（ボタン押下、モーダル開閉、フォーム送信、キー操作の見た目上の反応）')
console.log('- HtmlService.createHtmlOutputFromFileが実際のGAS環境で各部分ファイルをHTMLエスケープなしに正しく解決すること')
console.log('- 5ファイル分割後の実行順・初期化がブラウザのグローバルスコープで従来どおり機能すること')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
