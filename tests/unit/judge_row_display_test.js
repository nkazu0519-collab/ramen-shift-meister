// 判定詳細テーブルの表示モデル生成（buildJudgeRowDisplay_）を、本番のapp/js_judge.htmlから
// 関数定義をそのまま抜き出してNode.jsのvmで評価し、直接呼び出して検証する。
// ロジックをこのファイルへ再実装しない（詳細・検証範囲はREADME.mdを参照）。
//
// buildJudgeRowDisplay_はDOM APIに依存しない純粋関数だが、js_judge.html内には
// document/windowを参照する他の関数も含まれるため、ファイル全体をvmへ渡さず、
// 関数定義の文字列だけを正規表現で抽出して評価する
// （抽出はソースの切り出しであり、ロジックの書き写しではない。ステージ3でview_home.htmlの
// インラインJavaScriptがjs_judge.html等へ分割されたことに伴い、抽出元をここへ更新した）。
//
// レビュー対応（9月25日提出版_合計スコア表示の削除 2026-09-23）：buildJudgeRowDisplay_は
// scoreNote（参考スコア文）を組み立てなくなった。このテストは新仕様に合わせて更新し、
// scoreNoteが戻り値に含まれないこと・判定詳細テーブルのDOMにscoreNote要素が
// 生成されないことを検証する否定テストを追加した。
//
// 実行: node judge_row_display_test.js
// 失敗時は終了コード1で終わる。

'use strict'

var fs = require('fs')
var path = require('path')
var vm = require('vm')

var JS_JUDGE_PATH = path.join(__dirname, '..', '..', 'src', 'js_judge.html')

function loadBuildJudgeRowDisplay_() {
  var source = fs.readFileSync(JS_JUDGE_PATH, 'utf8')
  var m = source.match(/function buildJudgeRowDisplay_\(r\) \{[\s\S]*?\n      \}/)
  if (!m) {
    throw new Error('buildJudgeRowDisplay_の定義がjs_judge.htmlから見つかりませんでした')
  }
  var sandbox = { console: console }
  vm.createContext(sandbox)
  vm.runInContext(m[0], sandbox, { filename: JS_JUDGE_PATH })
  return sandbox.buildJudgeRowDisplay_
}

/**
 *  判定詳細テーブルの1行を実際に描画するrenderJudgeResultTable_の該当部分（詳細列の組み立て）を、
 *  本番js_judge.htmlから抽出して評価する。buildJudgeRowDisplay_の戻り値からDOMを組み立てる
 *  処理自体にscoreNote用の要素生成が残っていないことを、フェイクDOMで直接確認するために使う。
 *  renderJudgeResultTable_全体はcurrentJudgeSlots_等のトップレベル状態に依存するため、
 *  ここでは関数全体をそのままvmへロードし、状態を直接差し込んで呼び出す
 */
function loadRenderJudgeResultTableEnv_() {
  var source = fs.readFileSync(JS_JUDGE_PATH, 'utf8')
  var buildFnMatch = source.match(/function buildJudgeRowDisplay_\(r\) \{[\s\S]*?\n      \}/)
  var renderFnMatch = source.match(/function renderJudgeResultTable_\(\) \{[\s\S]*?\n      \}/)
  if (!buildFnMatch) throw new Error('buildJudgeRowDisplay_の定義が見つかりませんでした')
  if (!renderFnMatch) throw new Error('renderJudgeResultTable_の定義が見つかりませんでした')

  function createFakeEl_() {
    var classes = {}
    return {
      innerHTML: '',
      hidden: false,
      textContent: '',
      className: '',
      colSpan: 0,
      children: [],
      classList: {
        add: function (c) { classes[c] = true },
        remove: function (c) { delete classes[c] },
        contains: function (c) { return !!classes[c] }
      },
      appendChild: function (child) { this.children.push(child); return child }
    }
  }

  var tbody = createFakeEl_()
  var fakeDocument = {
    getElementById: function (id) { return id === 'judge_result_body' ? tbody : createFakeEl_() },
    createElement: function () { return createFakeEl_() }
  }

  var sandbox = {
    console: console,
    document: fakeDocument,
    currentJudgeSlots_: [],
    currentJudgeFilter_: 'all',
    classifyJudgeSlot_: function (r) {
      var d = sandbox.buildJudgeRowDisplay_(r)
      return d.primaryLabel === '成立' ? 'ok' : 'fail'
    }
  }
  vm.createContext(sandbox)
  vm.runInContext(buildFnMatch[0] + '\n' + renderFnMatch[0], sandbox, { filename: JS_JUDGE_PATH })

  return {
    sandbox: sandbox,
    tbody: tbody,
    render: function (slots) {
      sandbox.currentJudgeSlots_ = slots
      sandbox.currentJudgeFilter_ = 'all'
      sandbox.renderJudgeResultTable_()
    }
  }
}

/**
 *  フェイクtbody配下のtd（詳細列は各行4番目のtd。時間帯・混雑区分・出勤人数/必要人数・判定・詳細の5列）を
 *  再帰的にたどり、textContentを持つ全ノードのテキストを連結して1文字列にする
 *  （details/summary/ul/li/pをネストして作るため、末端要素のtextContentだけを拾う）
 */
function collectAllText_(el) {
  var texts = []
  function walk(node) {
    if (!node) return
    if (node.children && node.children.length > 0) {
      for (var i = 0; i < node.children.length; i++) walk(node.children[i])
    } else if (node.textContent) {
      texts.push(node.textContent)
    }
  }
  walk(el)
  return texts.join(' ')
}

function collectClassNames_(el) {
  var names = []
  function walk(node) {
    if (!node) return
    if (node.className) names.push(node.className)
    if (node.children) {
      for (var i = 0; i < node.children.length; i++) walk(node.children[i])
    }
  }
  walk(el)
  return names
}

var buildJudgeRowDisplay_ = loadBuildJudgeRowDisplay_()

var pass = 0, fail = 0
function assertEqual(actual, expected, label) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label + ' -> ' + JSON.stringify(actual) + (ok ? '' : ' (expected ' + JSON.stringify(expected) + ')'))
  if (ok) pass++; else fail++
}
function assertContains(haystack, needle, label) {
  var ok = String(haystack).indexOf(needle) >= 0
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label + ' -> ' + JSON.stringify(haystack))
  if (ok) pass++; else fail++
}
function assertNotContains(haystack, needle, label) {
  var ok = String(haystack).indexOf(needle) === -1
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label + ' -> ' + JSON.stringify(haystack))
  if (ok) pass++; else fail++
}
function assertTrue(actual, label) {
  var ok = !!actual
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label)
  if (ok) pass++; else fail++
}

console.log('検証対象: ' + JS_JUDGE_PATH)
console.log('---')

// サーバー（judgeShiftsForDate/buildSlotJudgeResult_）が実際に返す形のオブジェクトをそのまま使う
// （実効予備表示_実機テスト結果_2026-09-12.md のケースA〜Dと対応させる）。
// total_score・standard_scoreはサーバー側の内部計算として引き続きレスポンスに含まれるため、
// テストの入力オブジェクトにも残す（buildJudgeRowDisplay_がそれを無視することを確認する）

// 1. 成立・実効予備0（ケースA） → 主要表示は「成立」だけ（予備なし/予備ありの補助バッジは出さない）
var caseA = {
  label: '20:00〜21:00',
  congestion: '高／ピーク',
  present_count: 5,
  required_count: 5,
  coverage_ok: true,
  status: '成立',
  shortage_labels: ['ホール', 'セット', '麺上げ'],
  detail_lines: [
    'ホール：必要2人／実効担当候補2人／予備0人',
    'セット：必要1人／実効担当候補1人／予備0人',
    '麺上げ：必要1人／実効担当候補1人／予備0人'
  ],
  message_lines: ['成立していますが、必須持ち場に予備がありません'],
  total_score: 32,
  standard_score: 23
}
var dA = buildJudgeRowDisplay_(caseA)
assertEqual(dA.primaryLabel, '成立', '1. ケースA（実効予備0）: primaryLabel=成立')
assertEqual(dA.secondaryLabel, '', '1. ケースA（実効予備0）: secondaryLabelは空（補助バッジを出さない）')
assertEqual(dA.primaryClass, 'judge-badge-ok', '1. ケースA: primaryClass')

// 2. 成立・実効予備あり（ケースB） → 主要表示は「成立」だけ
var caseB = {
  label: '20:00〜21:00',
  congestion: '高／ピーク',
  present_count: 5,
  required_count: 5,
  coverage_ok: true,
  status: '成立',
  shortage_labels: [],
  detail_lines: [
    'ホール：必要2人／実効担当候補3人／予備1人',
    'セット：必要1人／実効担当候補2人／予備1人',
    '麺上げ：必要1人／実効担当候補2人／予備1人'
  ],
  message_lines: ['必要な持ち場を満たし、配置変更の余地があります'],
  total_score: 32,
  standard_score: 23
}
var dB = buildJudgeRowDisplay_(caseB)
assertEqual(dB.primaryLabel, '成立', '2. ケースB（実効予備あり）: primaryLabel=成立')
assertEqual(dB.secondaryLabel, '', '2. ケースB（実効予備あり）: secondaryLabelは空（補助バッジを出さない）')

// 3. 人数不足 → 不成立、人数不足
var caseCountShort = {
  label: '20:00〜21:00',
  congestion: '高／ピーク',
  present_count: 2,
  required_count: 5,
  coverage_ok: false,
  status: '不成立',
  shortage_labels: [],
  detail_lines: [],
  message_lines: ['人数不足：あと3人'],
  total_score: 3,
  standard_score: 23
}
var dCount = buildJudgeRowDisplay_(caseCountShort)
assertEqual(dCount.primaryLabel, '不成立', '3. 人数不足: primaryLabel=不成立')
assertEqual(dCount.secondaryLabel, '人数不足', '3. 人数不足: secondaryLabel=人数不足')
assertEqual(dCount.secondaryClass, 'judge-badge-fail', '3. 人数不足: secondaryClass')

// 4. 人数充足・持ち場不足（実機テスト結果ケースD）→ 不成立、持ち場不足
// レビュー対応（不成立詳細の不足のみ表示 2026-09-24）：不足している麺上げだけを1行で表示する。
// 旧長文（「持ち場不足：必要な持ち場を…」）・括弧補足・足りているホール等の行は出さない
var caseD = {
  label: '20:00〜21:00',
  congestion: '高／ピーク',
  present_count: 5,
  required_count: 5,
  coverage_ok: false,
  status: '不成立',
  shortage_labels: [],
  detail_lines: [],
  message_lines: ['麺上げ：必要1人／担当可能0人'],
  total_score: 15,
  standard_score: 23
}
var dD = buildJudgeRowDisplay_(caseD)
assertEqual(dD.primaryLabel, '不成立', '4. ケースD: primaryLabel=不成立')
assertEqual(dD.secondaryLabel, '持ち場不足', '4. ケースD: secondaryLabel=持ち場不足')
assertEqual(dD.secondaryClass, 'judge-badge-fail', '4. ケースD: secondaryClass')

// 5. 成立時の詳細にdetail_linesが入る
assertEqual(dA.detailLines, caseA.detail_lines, '5. ケースA: detailLinesはサーバーのdetail_linesそのもの')

// 6. 不成立時の詳細にmessage_linesが入る
assertEqual(dD.detailLines, caseD.message_lines, '6. ケースD: detailLinesはサーバーのmessage_linesそのもの')

// 7〜9. レビュー対応（9月25日提出版_合計スコア表示の削除）：戻り値にscoreNoteを含まない否定テスト
// （修正前コードではscoreNoteキーが存在し、'合計スコア'を含む文字列が入っていたため、
//   このテストは修正前コードでは失敗する）
assertEqual(Object.prototype.hasOwnProperty.call(dA, 'scoreNote'), false, '7. ケースA: 戻り値にscoreNoteキーを含まない')
assertEqual(Object.prototype.hasOwnProperty.call(dB, 'scoreNote'), false, '7. ケースB: 戻り値にscoreNoteキーを含まない')
assertEqual(Object.prototype.hasOwnProperty.call(dCount, 'scoreNote'), false, '7. 人数不足: 戻り値にscoreNoteキーを含まない')
assertEqual(Object.prototype.hasOwnProperty.call(dD, 'scoreNote'), false, '7. ケースD: 戻り値にscoreNoteキーを含まない')

// 8. 主要セルへ長文メッセージが入らないことの確認
// buildJudgeRowDisplay_の戻り値には、主要5列（時間帯・混雑区分・出勤人数／必要人数・判定・詳細）に
// 対応するフィールドしかなく、長文はdetailLines（詳細側）にのみ含まれることを
// 戻り値のキー集合で確認する（primaryLabel/secondaryLabelはラベル文字列のみで長文を含まない）
var keys = Object.keys(dA).sort()
assertEqual(keys, ['detailLines', 'primaryClass', 'primaryLabel', 'secondaryClass', 'secondaryLabel'].sort(), '8. 戻り値のキー構成（scoreNoteを含まない5キーのみ）')
assertEqual(dA.primaryLabel.length <= 4, true, '8. primaryLabelは短いラベル文字列（長文ではない）')
assertEqual(dA.secondaryLabel.length <= 4, true, '8. secondaryLabelは短いラベル文字列（長文ではない）')

// 低／アイドル・中区分（実機テスト結果ケースE・F相当）でも同じ関数がそのまま使えることの回帰確認
var caseE = {
  label: '18:00〜19:00',
  congestion: '低／アイドル',
  present_count: 2,
  required_count: 2,
  coverage_ok: true,
  status: '成立',
  shortage_labels: ['麺上げ', 'ホール・セット兼任'],
  detail_lines: [
    '麺上げ：必要1人／実効担当候補1人／予備0人',
    'ホール・セット兼任：必要1人／実効担当候補1人／予備0人'
  ],
  message_lines: ['成立していますが、必須持ち場に予備がありません'],
  total_score: 14,
  standard_score: 17
}
var dE = buildJudgeRowDisplay_(caseE)
assertEqual(dE.primaryLabel, '成立', '回帰: ケースE（低／アイドル）: primaryLabel=成立')
assertEqual(dE.secondaryLabel, '', '回帰: ケースE（低／アイドル）: secondaryLabelは空（補助バッジを出さない）')

// ------------------------------------------------------------------
// 9〜10. 判定詳細テーブルのDOMに、judge-score-note要素や「合計スコア」「旧基準」の文言が
//        生成されないことを確認する（renderJudgeResultTable_を実際に呼び出して検証する）
// ------------------------------------------------------------------
console.log('---')
console.log('検証対象2: renderJudgeResultTable_が組み立てる判定詳細テーブルのDOM')
console.log('---')

var tableEnv = loadRenderJudgeResultTableEnv_()
tableEnv.render([caseA, caseD])

var allText = collectAllText_(tableEnv.tbody)
assertNotContains(allText, '合計スコア', '9. 判定詳細テーブルのDOMテキストに「合計スコア」が含まれない')
assertNotContains(allText, '旧基準', '9. 判定詳細テーブルのDOMテキストに「旧基準」が含まれない')
assertContains(allText, 'ホール：必要2人／実効担当候補2人／予備0人', '9. 判定詳細テーブルのDOMには実効予備の詳細行が引き続き含まれる（成立時）')
assertContains(allText, '麺上げ：必要1人／担当可能0人', '9. 判定詳細テーブルのDOMには不足している持ち場の行が引き続き含まれる（不成立時）')

// テストF: 旧長文・括弧補足・足りている持ち場が混ざらないことの否定テスト
assertNotContains(allText, '持ち場不足：必要な持ち場を重複なく割り当てられません', 'F. 旧長文が判定詳細テーブルのDOMに含まれない')
assertNotContains(allText, '同じ従業員を複数の持ち場には配置できません', 'F. 括弧補足が判定詳細テーブルのDOMに含まれない')
assertNotContains(allText, '参考：', 'F. 「参考：」の見出しが判定詳細テーブルのDOMに含まれない')
assertNotContains(allText, 'ホール：必要2人／担当可能2人', 'F. 足りているホールの行が判定詳細テーブルのDOMに含まれない（不成立時）')

var allClassNames = collectClassNames_(tableEnv.tbody)
var hasScoreNoteClass = allClassNames.indexOf('judge-score-note') !== -1
assertEqual(hasScoreNoteClass, false, '10. 判定詳細テーブルのDOMにjudge-score-noteクラスの要素が生成されない')

console.log('---')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
