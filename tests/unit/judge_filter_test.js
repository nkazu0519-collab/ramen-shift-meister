// 判定結果一覧の状態別絞り込み（仮説検証用の最小実装）を、本番のapp/js_judge.htmlから
// 関数定義をそのまま抜き出してNode.jsのvmで評価し、直接呼び出して検証する。
// ロジックをこのファイルへ再実装しない。
//
// classifyJudgeSlot_・countJudgeSlotsByFilter_・decideInitialJudgeFilter_・buildJudgeRowDisplay_は
// いずれもDOM APIに依存しない純粋関数だが、js_judge.html内にはdocument/windowを参照する
// 他の関数も含まれるため、ファイル全体をvmへ渡さず、対象関数の定義文字列だけを正規表現で抽出して評価する
// （ステージ3でview_home.htmlのインラインJavaScriptがjs_judge.html等へ分割されたことに伴い、
// 抽出元をここへ更新した）。
//
// 実行: node judge_filter_test.js
// 失敗時は終了コード1で終わる。

'use strict'

var fs = require('fs')
var path = require('path')
var vm = require('vm')

var JS_JUDGE_PATH = path.join(__dirname, '..', '..', 'src', 'js_judge.html')

function extractFunction_(source, name, pattern) {
  var m = source.match(pattern)
  if (!m) {
    throw new Error(name + 'の定義がjs_judge.htmlから見つかりませんでした')
  }
  return m[0]
}

/**
 *  document.getElementById(id)が返すダミー要素を、テストで必要な最小限のプロパティだけ持たせて作る。
 *  renderJudgeFilterButtons_はinnerHTML/hidden/appendChildしか使わず、resetJudgeFilterState_は
 *  judge_summary・judge_open_detail_btnのhiddenだけを触る（実際のDOM描画・見た目はGAS実機でしか確認できない）
 */
function createFakeEl_() {
  return {
    innerHTML: '',
    hidden: false,
    textContent: '',
    children: [],
    appendChild: function (child) { this.children.push(child) },
    focus: function () {}
  }
}

/**
 *  document.bodyが返すダミー要素。closeJudgeDetailModal_・openJudgeDetailModal_が
 *  背景スクロール抑止用クラスの付け外しに使うclassList.add/removeだけを持たせる
 *  （実際のoverflow:hidden切り替え・スクロール位置の保持はGAS実機でしか確認できない）
 */
function createFakeBodyEl_() {
  return {
    classListValues: [],
    classList: {
      add: function (name) {
        if (this.values_.indexOf(name) === -1) this.values_.push(name)
      },
      remove: function (name) {
        var idx = this.values_.indexOf(name)
        if (idx !== -1) this.values_.splice(idx, 1)
      },
      values_: []
    }
  }
}

/**
 *  resetJudgeFilterState_はrenderJudgeFilterButtons_・closeJudgeDetailModal_・
 *  judge_summary/judge_open_detail_btnのDOM操作を行うため、classifyJudgeSlot_系と同じ抽出方式に加え、
 *  document自体を最小限スタブする。idごとに固定のダミー要素を返す（呼び出しのたびに新しいオブジェクトを
 *  返すと、テスト側でhidden等の状態を確認できないため）。buttonのclassList.toggle等は何もしないダミーでよい
 *  （選択状態の見た目・クリック挙動そのものはGAS実機でしか確認できない。ここでは
 *  resetJudgeFilterState_呼び出し後にcurrentJudgeSlots_・currentJudgeFilter_・
 *  各要素のhiddenが初期値へ戻ることだけを検証する）
 */
function createFakeDocument_() {
  var elementsById = {
    judge_filter_bar: createFakeEl_(),
    judge_summary: createFakeEl_(),
    judge_open_detail_btn: createFakeEl_(),
    judge_detail_modal: createFakeEl_(),
    timeline_judge_track: createFakeEl_(),
    judge_result_body: createFakeEl_()
  }
  return {
    elementsById: elementsById,
    body: createFakeBodyEl_(),
    getElementById: function (id) {
      if (!elementsById[id]) elementsById[id] = createFakeEl_()
      return elementsById[id]
    },
    createElement: function () {
      return {
        classList: { toggle: function () {} },
        setAttribute: function () {},
        addEventListener: function () {},
        appendChild: function () {},
        focus: function () {}
      }
    }
  }
}

function loadJudgeFilterFns_() {
  var source = fs.readFileSync(JS_JUDGE_PATH, 'utf8')

  var classifySrc = extractFunction_(source, 'classifyJudgeSlot_', /function classifyJudgeSlot_\(r\) \{[\s\S]*?\n      \}/)
  var countSrc = extractFunction_(source, 'countJudgeSlotsByFilter_', /function countJudgeSlotsByFilter_\(slots\) \{[\s\S]*?\n      \}/)
  var decideSrc = extractFunction_(source, 'decideInitialJudgeFilter_', /function decideInitialJudgeFilter_\(counts\) \{[\s\S]*?\n      \}/)
  var buildDisplaySrc = extractFunction_(source, 'buildJudgeRowDisplay_', /function buildJudgeRowDisplay_\(r\) \{[\s\S]*?\n      \}/)
  var judgeFilterDefsSrc = extractFunction_(source, 'JUDGE_FILTER_DEFS_', /var JUDGE_FILTER_DEFS_ = \[[\s\S]*?\n      \]/)
  var renderButtonsSrc = extractFunction_(source, 'renderJudgeFilterButtons_', /function renderJudgeFilterButtons_\(\) \{[\s\S]*?\n      \}/)
  var modalOpenBodyClassSrc = extractFunction_(source, 'JUDGE_DETAIL_MODAL_OPEN_BODY_CLASS_', /var JUDGE_DETAIL_MODAL_OPEN_BODY_CLASS_ = '[^']*'/)
  var closeModalSrc = extractFunction_(source, 'closeJudgeDetailModal_', /function closeJudgeDetailModal_\(\) \{[\s\S]*?\n      \}/)
  var resetSrc = extractFunction_(source, 'resetJudgeFilterState_', /function resetJudgeFilterState_\(\) \{[\s\S]*?\n      \}/)
  var summarySrc = extractFunction_(source, 'renderJudgeSummary_', /function renderJudgeSummary_\(slotResults, counts\) \{[\s\S]*?\n      \}/)
  var resultTableSrc = extractFunction_(source, 'renderJudgeResultTable_', /function renderJudgeResultTable_\(\) \{[\s\S]*?\n      \}/)
  var resultsSrc = extractFunction_(source, 'renderJudgeResults', /function renderJudgeResults\(results\) \{[\s\S]*?\n      \}/)

  var sandbox = {
    console: console,
    document: createFakeDocument_(),
    currentJudgeFilter_: 'all',
    currentJudgeSlots_: [],
    judgeDetailModalTriggerEl: null,
    // renderJudgeResultsが呼ぶ外部関数（js_home_common.html/休憩候補描画）は今回の検証範囲外のため、
    // 呼び出しを記録するだけのダミーに差し替える（時間軸セルの生成ロジックだけを対象にする）
    updateJudgeMessage: function (message) { sandbox.lastJudgeMessage_ = message },
    clearBreakResults_: function () {},
    renderBreakResults_: function () {}
  }
  vm.createContext(sandbox)
  // classifyJudgeSlot_はbuildJudgeRowDisplay_を呼ぶため、先に定義しておく。
  // renderJudgeFilterButtons_はJUDGE_FILTER_DEFS_・countJudgeSlotsByFilter_を参照し、
  // resetJudgeFilterState_はrenderJudgeFilterButtons_・closeJudgeDetailModal_を参照するため、
  // resetJudgeFilterState_より前にすべて定義しておく。renderJudgeSummary_は他から独立して
  // 呼べる関数だが、同じdocumentスタブを共有するためここでまとめて評価する。
  // renderJudgeResultsはrenderJudgeFilterButtons_・renderJudgeResultTable_・renderJudgeSummary_・
  // decideInitialJudgeFilter_・countJudgeSlotsByFilter_・updateJudgeMessage・renderBreakResults_に
  // 依存するため最後に定義する
  vm.runInContext(
    buildDisplaySrc + '\n' + classifySrc + '\n' + countSrc + '\n' + decideSrc + '\n' +
    judgeFilterDefsSrc + '\n' + renderButtonsSrc + '\n' + modalOpenBodyClassSrc + '\n' +
    closeModalSrc + '\n' + resetSrc + '\n' + summarySrc + '\n' + resultTableSrc + '\n' + resultsSrc,
    sandbox,
    { filename: JS_JUDGE_PATH }
  )
  return {
    sandbox: sandbox,
    classifyJudgeSlot_: sandbox.classifyJudgeSlot_,
    countJudgeSlotsByFilter_: sandbox.countJudgeSlotsByFilter_,
    decideInitialJudgeFilter_: sandbox.decideInitialJudgeFilter_,
    resetJudgeFilterState_: sandbox.resetJudgeFilterState_,
    renderJudgeSummary_: sandbox.renderJudgeSummary_,
    renderJudgeResults: sandbox.renderJudgeResults,
    JUDGE_FILTER_DEFS_: sandbox.JUDGE_FILTER_DEFS_
  }
}

var fns = loadJudgeFilterFns_()
var classifyJudgeSlot_ = fns.classifyJudgeSlot_
var countJudgeSlotsByFilter_ = fns.countJudgeSlotsByFilter_
var decideInitialJudgeFilter_ = fns.decideInitialJudgeFilter_
var resetJudgeFilterState_ = fns.resetJudgeFilterState_
var renderJudgeSummary_ = fns.renderJudgeSummary_
var renderJudgeResults = fns.renderJudgeResults
var sandbox_ = fns.sandbox
var elementsById_ = sandbox_.document.elementsById

var pass = 0, fail = 0
function assertEqual(actual, expected, label) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label + ' -> ' + JSON.stringify(actual) + (ok ? '' : ' (expected ' + JSON.stringify(expected) + ')'))
  if (ok) pass++; else fail++
}
function assertTrue_(condition, label) {
  var ok = !!condition
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label)
  if (ok) pass++; else fail++
}

console.log('検証対象: ' + JS_JUDGE_PATH)
console.log('---')

// サーバー（judgeShiftsForDate/buildSlotJudgeResult_）が実際に返す形のオブジェクトをそのまま使う
// （judge_row_display_test.jsのケースA〜Dと同じ入力を再利用する）

var caseFailCount = { status: '不成立', present_count: 2, required_count: 5, shortage_labels: [], detail_lines: [], message_lines: ['人数不足：あと3人'], total_score: 3, standard_score: 23 }
var caseFailRole = { status: '不成立', present_count: 5, required_count: 5, shortage_labels: [], detail_lines: [], message_lines: ['持ち場不足：必要な持ち場を重複なく割り当てられません'], total_score: 15, standard_score: 23 }
var caseNoReserve = { status: '成立', present_count: 5, required_count: 5, shortage_labels: ['ホール'], detail_lines: ['ホール：必要2人／実効担当候補2人／予備0人'], message_lines: ['成立していますが、必須持ち場に予備がありません'], total_score: 32, standard_score: 23 }
var caseHasReserve = { status: '成立', present_count: 5, required_count: 5, shortage_labels: [], detail_lines: ['ホール：必要2人／実効担当候補3人／予備1人'], message_lines: ['必要な持ち場を満たし、配置変更の余地があります'], total_score: 32, standard_score: 23 }

// 0. 絞り込みの選択肢は「不成立／成立／すべて」の3種類だけになっている（予備なし／予備ありは削除）
assertEqual(
  fns.JUDGE_FILTER_DEFS_.map(function (d) { return d.key }),
  ['fail', 'ok', 'all'],
  '0. 絞り込みの選択肢キーが不成立／成立／すべての3種類'
)
assertEqual(
  fns.JUDGE_FILTER_DEFS_.map(function (d) { return d.label }),
  ['不成立', '成立', 'すべて'],
  '0. 絞り込みの選択肢ラベルが不成立／成立／すべての3種類'
)

// 1. 分類：不成立（人数不足／持ち場不足はどちらもfailにまとめる）／成立（実効予備の有無は問わずokにまとめる）
assertEqual(classifyJudgeSlot_(caseFailCount), 'fail', '1. 人数不足はfail')
assertEqual(classifyJudgeSlot_(caseFailRole), 'fail', '1. 持ち場不足はfail')
assertEqual(classifyJudgeSlot_(caseNoReserve), 'ok', '1. 成立・実効予備0はok')
assertEqual(classifyJudgeSlot_(caseHasReserve), 'ok', '1. 成立・実効予備ありもok')

// 2. 混在する場合の件数と絞り込み
var mixedSlots = [caseFailCount, caseFailRole, caseNoReserve, caseHasReserve, caseHasReserve]
var mixedCounts = countJudgeSlotsByFilter_(mixedSlots)
assertEqual(mixedCounts, { fail: 2, ok: 3, all: 5 }, '2. 混在ケースの件数')
assertEqual(decideInitialJudgeFilter_(mixedCounts), 'fail', '2. 混在ケースの初期表示は不成立')

// 3. 不成立が0件の場合の初期表示は「成立」になる
var noFailSlots = [caseNoReserve, caseHasReserve]
var noFailCounts = countJudgeSlotsByFilter_(noFailSlots)
assertEqual(noFailCounts, { fail: 0, ok: 2, all: 2 }, '3. 不成立0件ケースの件数')
assertEqual(decideInitialJudgeFilter_(noFailCounts), 'ok', '3. 不成立0件→初期表示は成立')

// 4. 全件成立でも初期表示は「成立」になる
var onlyReserveSlots = [caseHasReserve, caseHasReserve]
var onlyReserveCounts = countJudgeSlotsByFilter_(onlyReserveSlots)
assertEqual(onlyReserveCounts, { fail: 0, ok: 2, all: 2 }, '4. 全件成立ケースの件数')
assertEqual(decideInitialJudgeFilter_(onlyReserveCounts), 'ok', '4. 全件成立でも初期表示は成立')

// 5. 各分類が0件の場合（該当なしでも件数計算は例外を投げない）
assertEqual(countJudgeSlotsByFilter_([]), { fail: 0, ok: 0, all: 0 }, '5. 0件時の件数はすべて0')

// 6. 再判定開始時（resetJudgeFilterState_）に、古いcurrentJudgeSlots_・currentJudgeFilter_・
// メイン画面の要約(judge_summary)・「判定結果を見る」ボタン(judge_open_detail_btn)・
// 判定詳細モーダル(judge_detail_modal)が残らないことを確認する
// （Codexレビュー指摘：通信中・通信失敗時に古い件数・要約が残り、古い「判定結果を見る」を
// 押すと前回結果が再表示される問題への対応。今回のモーダル化に伴い、要約・ボタン・モーダルの
// 非表示化も同じresetJudgeFilterState_に統合したため、まとめて検証する）
sandbox_.currentJudgeSlots_ = mixedSlots
sandbox_.currentJudgeFilter_ = 'fail'
elementsById_.judge_summary.hidden = false
elementsById_.judge_open_detail_btn.hidden = false
elementsById_.judge_detail_modal.hidden = false
assertEqual(sandbox_.currentJudgeSlots_.length, 5, '6a. リセット前提として前回結果が入っていることを確認')

resetJudgeFilterState_()

assertEqual(sandbox_.currentJudgeSlots_, [], '6b. resetJudgeFilterState_後、currentJudgeSlots_は空配列に戻る')
assertEqual(sandbox_.currentJudgeFilter_, 'all', '6c. resetJudgeFilterState_後、currentJudgeFilter_はallに戻る')
assertEqual(elementsById_.judge_summary.hidden, true, '6d. resetJudgeFilterState_後、judge_summaryはhiddenになる')
assertEqual(elementsById_.judge_open_detail_btn.hidden, true, '6e. resetJudgeFilterState_後、judge_open_detail_btnはhiddenになる')
assertEqual(elementsById_.judge_detail_modal.hidden, true, '6f. resetJudgeFilterState_後、judge_detail_modal(前回結果を開けなくする)はhiddenになる')

// 7. resetJudgeFilterState_を2回連続で呼んでも（例：handleJudgeClickで一度、
// withFailureHandlerでもう一度、のように連続で呼ばれるケース）、状態は初期値のまま壊れない
sandbox_.currentJudgeSlots_ = mixedSlots
sandbox_.currentJudgeFilter_ = 'fail'
resetJudgeFilterState_()
resetJudgeFilterState_()
assertEqual(sandbox_.currentJudgeSlots_, [], '7. 連続リセットでもcurrentJudgeSlots_は空配列のまま')
assertEqual(sandbox_.currentJudgeFilter_, 'all', '7. 連続リセットでもcurrentJudgeFilter_はallのまま')

// 8. renderJudgeSummary_を本番ファイルから直接読み込んで検証する（Codexレビュー指摘4への対応）。
// メイン画面に残した要約テキストと「判定結果を見る」ボタンのhidden切り替えが正しいことを確認する
elementsById_.judge_summary.hidden = true
elementsById_.judge_open_detail_btn.hidden = true

// 8a. 「不成立◯件／成立◯件」の2区分だけの文言で表示される
renderJudgeSummary_(mixedSlots, mixedCounts)
assertEqual(elementsById_.judge_summary.textContent, '不成立2件／成立3件', '8a. 混在ケースの要約文言')
assertEqual(elementsById_.judge_summary.hidden, false, '8a. 混在ケースでjudge_summaryは表示される')
assertEqual(elementsById_.judge_open_detail_btn.hidden, false, '8a. 混在ケースでjudge_open_detail_btnは表示される')

// 8b. 結果0件では要約とボタンがhiddenになる
renderJudgeSummary_([], countJudgeSlotsByFilter_([]))
assertEqual(elementsById_.judge_summary.hidden, true, '8b. 結果0件でjudge_summaryはhiddenになる')
assertEqual(elementsById_.judge_open_detail_btn.hidden, true, '8b. 結果0件でjudge_open_detail_btnはhiddenになる')

// 8c. 結果ありでは要約とボタンが表示される（不成立0件のケースでも文言が組み立つことを確認）
renderJudgeSummary_(onlyReserveSlots, onlyReserveCounts)
assertEqual(elementsById_.judge_summary.textContent, '不成立0件／成立2件', '8c. 全件成立ケースの要約文言')
assertEqual(elementsById_.judge_summary.hidden, false, '8c. 結果ありでjudge_summaryは表示される')
assertEqual(elementsById_.judge_open_detail_btn.hidden, false, '8c. 結果ありでjudge_open_detail_btnは表示される')

// 8d. リセット後（resetJudgeFilterState_）に再びhiddenになる
resetJudgeFilterState_()
assertEqual(elementsById_.judge_summary.hidden, true, '8d. リセット後、judge_summaryは再びhiddenになる')
assertEqual(elementsById_.judge_open_detail_btn.hidden, true, '8d. リセット後、judge_open_detail_btnは再びhiddenになる')

// 9. renderJudgeResultsを本番ファイルから直接読み込んで検証する（Codexレビュー指摘：時間軸の主要判断を
// 成立／不成立に統一し、成立セルのツールチップから予備情報を外す）。
// 表示ロジックをテスト側へ複製せず、本番のrenderJudgeResultsをそのまま呼び出して
// timeline_judge_trackへ積まれたセル（div要素）のclassName/textContent/titleで確認する
var caseHasReserveWithLabel_ = Object.assign({ label: '20:00〜21:00' }, caseHasReserve)
var caseFailCountWithLabel_ = Object.assign({ label: '21:00〜22:00' }, caseFailCount)
elementsById_.timeline_judge_track.children = []
elementsById_.judge_result_body.children = []
renderJudgeResults({ slots: [caseHasReserveWithLabel_, caseFailCountWithLabel_] })
var judgeCells_ = elementsById_.timeline_judge_track.children

assertEqual(judgeCells_.length, 2, '9. 時間軸セルがslots件数分だけ描画される')

var okCell_ = judgeCells_[0]
assertEqual(okCell_.textContent, '成立', '9. 成立セルの表示文字は「成立」（「不足」ではない）')
assertEqual(okCell_.className, 'timeline-judge-cell status-ok', '9. 成立セルに従来どおりstatus-okクラスが付く')
assertEqual(okCell_.title, '20:00〜21:00：成立', '9. 成立セルのtitleは「時間帯：成立」のみ')
assertTrue_(okCell_.title.indexOf('予備') === -1, '9. 成立セルのtitleに「予備」が含まれない')
assertTrue_(okCell_.title.indexOf('配置変更の余地') === -1, '9. 成立セルのtitleに「配置変更の余地」が含まれない')

var failCell_ = judgeCells_[1]
assertEqual(failCell_.textContent, '不成立', '9. 不成立セルの表示文字は「不成立」')
assertEqual(failCell_.className, 'timeline-judge-cell status-fail', '9. 不成立セルに従来どおりstatus-failクラスが付く')
assertTrue_(failCell_.title.indexOf('不成立') !== -1, '9. 不成立セルのtitleに「不成立」が含まれる')
assertTrue_(failCell_.title.indexOf('人数不足') !== -1, '9. 不成立セルのtitleに不足理由（人数不足）が含まれる')

console.log('---')
console.log('【GAS実機確認が必要】このテストでは検証できない範囲:')
console.log('- 判定ボタン連打時、通信中に絞り込みボタン・要約・「判定結果を見る」が実際に非表示になること')
console.log('- 通信失敗(withFailureHandler)時、画面上で要約・件数バッジ・選択中ボタンの表示が実際に消えること')
console.log('- 前回結果表示中に古い「判定結果を見る」ボタンをクリックしても、通信完了前は反応しない(古い結果が再表示されない)こと')
console.log('- #judge_open_detail_btn/.judge-summary[hidden]/.judge-filter-bar/.modal-overlayのdisplay:none/:not([hidden])切り替えが実ブラウザで正しく効くこと（.btn-secondaryのdisplay:inline-flexに上書きされず、判定前・判定中・エラー時に確実に非表示になること）')
console.log('- .judge-action-row内で「この日のシフトを判定」「判定結果を見る」「要約」が実際に横並びになり、狭い画面でflex-wrapにより自然に折り返すこと。既存のbtn-frame（他画面）の見た目に影響が出ていないこと')
console.log('- 「判定中...」やエラーメッセージ（judge_message）が操作行の下に表示されること')
console.log('- 判定詳細モーダルが開く・閉じるときの実際のフォーカス移動（開くとjudge_detail_modal_close_btn、閉じるとjudge_open_detail_btnへ）')
console.log('- Escapeキー・背景クリックで判定詳細モーダルが閉じ、シフト変更モーダルと競合しないこと')
console.log('- 判定詳細モーダルを開いている間、モーダル内部をスクロールしても背景ページ（body）が動かないこと。閉じた際に背景スクロールが再び効き、元のスクロール位置が保たれていること。シフト変更・削除モーダルの表示・スクロール挙動に影響が出ていないこと')
console.log('- デスクトップでモーダルが十分な横幅を持ち、スマートフォン幅ではほぼ全画面になること')
console.log('- 行数が多い場合、ページ全体ではなくモーダル内部（.table-scroll）だけがスクロールすること')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
