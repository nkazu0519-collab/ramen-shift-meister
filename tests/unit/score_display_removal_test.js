// レビュー対応（9月25日提出版_合計スコア表示の削除 2026-09-23）：
// 提出版のスコープ判断（07_ブラッシュアップ/01_方針・判断/提出版_スコープ判断_2026-09-23.md）により、
// 旧来の合計スコア表示を全画面から削除し、店主の判断材料を成立／不成立・不足理由・持ち場別
// 実効予備・技能ラベル・一人依存へ統一した。このテストは、本番のapp/内ファイルを直接
// 文字列として読み込み、店主が見るユーザー向け表示文言・DOM・CSSから「合計スコア」
// 「旧基準」「現在のスコア」「技能点」関連の表示が削除されたことを確認する否定テストである。
// ロジックをこのファイルへ再実装せず、本番ファイルのソース文字列・関数抽出結果を直接検証する。
//
// 内部計算（MEISTER_POINTS・calcMaisterScore()・total_score・standard_score）は
// 既存互換性のため意図的に残しており、このテストの対象外（削除しないことの確認は行わない）。
//
// 実行: node score_display_removal_test.js
// 失敗時は終了コード1で終わる。

'use strict'

var fs = require('fs')
var path = require('path')

var APP_DIR = path.join(__dirname, '..', '..', 'src')

var pass = 0, fail = 0
function assertNotContains(haystack, needle, label) {
  var ok = String(haystack).indexOf(needle) === -1
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label)
  if (!ok) console.log('     -> 含まれてはいけない文字列 "' + needle + '" が見つかりました')
  if (ok) pass++; else fail++
}
function assertContains(haystack, needle, label) {
  var ok = String(haystack).indexOf(needle) >= 0
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label)
  if (ok) pass++; else fail++
}
function assertEqual(actual, expected, label) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label + ' -> ' + JSON.stringify(actual) + (ok ? '' : ' (expected ' + JSON.stringify(expected) + ')'))
  if (ok) pass++; else fail++
}

function readApp_(name) {
  return fs.readFileSync(path.join(APP_DIR, name), 'utf8')
}

console.log('検証対象: ' + APP_DIR)
console.log('---')

// ------------------------------------------------------------------
// 1. view_home.html: 判定詳細モーダルの説明文から「合計スコア」表現が消えている
// ------------------------------------------------------------------
var viewHome = readApp_('view_home.html')
assertNotContains(viewHome, '合計スコアは参考値', '1. view_home.htmlに「合計スコアは参考値」の説明文がない')
assertContains(viewHome, '成立／不成立は人数と必須持ち場の割り当てだけで決めています', '1. view_home.htmlに成立条件の説明文は残っている')

// ------------------------------------------------------------------
// 2. js_judge.html: buildJudgeRowDisplay_・renderJudgeResultTable_の実行コードから
//    scoreNote関連の識別子・文言が消えている（judge_row_display_test.jsの関数戻り値検証とは
//    別に、ソース文字列レベルでも確認する）。コメント内でscoreNoteという識別子名に触れて
//    経緯を説明すること自体は開発者向け記録として許容するため、コメントを除いた実行コード
//    部分だけを対象にする（コメント除去はテストの後半で定義するstripJsComments_を使う）
// ------------------------------------------------------------------
var jsJudge = readApp_('js_judge.html')
var jsJudgeCode = stripJsComments_(jsJudge)
assertNotContains(jsJudgeCode, 'scoreNote', '2. js_judge.htmlの実行コードにscoreNoteという識別子がない（コメント除く）')
assertNotContains(jsJudgeCode, 'judge-score-note', '2. js_judge.htmlの実行コードにjudge-score-noteクラスの参照がない（コメント除く）')
assertNotContains(jsJudge, '成立判定には使用していません', '2. js_judge.htmlのソースに旧・参考スコア文の文言がない')

// ------------------------------------------------------------------
// 3. js_shift.html: シフト登録時の技能補足カードから「技能点」表示・案内文が消えている
// ------------------------------------------------------------------
var jsShift = readApp_('js_shift.html')
assertNotContains(jsShift, '技能点：', '3. js_shift.htmlのソースに「技能点：」という表示文言がない')
assertNotContains(jsShift, 'シフト全体の対応余力を確認するための合算用の点数です', '3. js_shift.htmlのソースに技能点の説明文がない')
assertNotContains(jsShift, 'skill-card__score', '3. js_shift.htmlのソースにskill-card__scoreクラスの参照がない')
assertContains(jsShift, '従業員を選択すると、取得マイスターが表示されます', '3. js_shift.htmlの未選択時案内は技能点を含まない新文言になっている')
assertNotContains(jsShift, '従業員を選択すると、取得マイスターと技能点が表示されます', '3. js_shift.htmlに旧・技能点を含む未選択時案内が残っていない')

// ------------------------------------------------------------------
// 4. view_detail.html: 従業員個別マイスター画面の見出し・保存結果表示からスコアが消えている
// ------------------------------------------------------------------
var viewDetail = readApp_('view_detail.html')
assertNotContains(viewDetail, '現在のスコア', '4. view_detail.htmlに「現在のスコア」の表示がない')
assertNotContains(viewDetail, 'maister_score_value', '4. view_detail.htmlにmaister_score_value（表示更新用DOM ID）がない')
assertNotContains(viewDetail, 'updateMaisterScore', '4. view_detail.htmlにupdateMaisterScore（表示更新専用関数）の定義・呼び出しがない')
assertNotContains(viewDetail, 'meister-score', '4. view_detail.htmlにmeister-scoreクラスの参照がない')
assertContains(viewDetail, '<h3>マイスター登録</h3>', '4. view_detail.htmlの見出しはスコア併記なしの単純な文言になっている')

// ------------------------------------------------------------------
// 4b. レビュー対応（個別点数表示の削除漏れ修正 2026-09-24）：view_detail.htmlの
//     マイスター個別チェックリストから、m.pointsの動的出力（点数表示）が消えている。
//     「技能点」のような固定文言の禁止語検索だけでは、m.points（GASテンプレートの<?= ?>による
//     動的出力）や専用クラスmeister-item__pointsを検出できなかったため、該当する表示要素
//     （チェックリストの1行分のテンプレート）自体を切り出して検証する。
//     マイスター名・チェックボックス・保存処理は維持されていることも同時に確認する
// ------------------------------------------------------------------
var meisterItemMatch = viewDetail.match(/<label class="meister-item">[\s\S]*?<\/label>/)
assertEqual(!!meisterItemMatch, true, '4b. 前提: view_detail.htmlからmeister-item（チェックリスト1行分）のテンプレートを抽出できた')
var meisterItemSrc = meisterItemMatch ? meisterItemMatch[0] : ''
assertNotContains(meisterItemSrc, 'm.points', '4b. meister-item内にm.points（点数の動的出力）がない')
assertNotContains(meisterItemSrc, '点）', '4b. meister-item内に「◯点）」という点数表示の閉じ括弧がない')
assertNotContains(meisterItemSrc, 'meister-item__points', '4b. meister-item内にmeister-item__points要素がない')
assertContains(meisterItemSrc, 'type="checkbox"', '4b. meister-item内にチェックボックスは残っている')
assertContains(meisterItemSrc, 'name="<?= m.key ?>"', '4b. meister-item内のチェックボックスはm.keyで保存対象を維持している')
assertContains(meisterItemSrc, '<?= m.checked ? \'checked\' : \'\' ?>', '4b. meister-item内のチェック状態（m.checked）は維持している')
assertContains(meisterItemSrc, 'meister-item__name', '4b. meister-item内にマイスター名表示（meister-item__name）は残っている')
assertContains(meisterItemSrc, '<?= m.key ?>', '4b. meister-item内のマイスター名表示はm.keyを出力している')
// 経緯コメント（削除漏れ修正の記録）は識別子名に触れて説明するため、HTMLコメントを除いた
// テンプレート本体を対象に、m.points・meister-item__pointsが実行コード側に残っていないか確認する
var viewDetailWithoutHtmlComments = viewDetail.replace(/<!--[\s\S]*?-->/g, '')
assertNotContains(viewDetailWithoutHtmlComments, 'm.points', '4c. view_detail.html（HTMLコメント除く）にm.pointsの出力が残っていない')
assertNotContains(viewDetailWithoutHtmlComments, 'meister-item__points', '4c. view_detail.html（HTMLコメント除く）にmeister-item__points要素が残っていない')

// ------------------------------------------------------------------
// 5. meister.gs: 個別保存成功メッセージにスコア・点数が含まれない
//    （内部計算のcalcMaisterScore・scoreフィールド自体は既存互換性のため残す。
//    このテストはpostMaisterBadges関数の定義部分だけを抽出し、message文字列の
//    組み立てにスコアを含めていないことを確認する）
// ------------------------------------------------------------------
var meisterGs = readApp_('meister.gs')
var postMaisterBadgesMatch = meisterGs.match(/function postMaisterBadges\(form\) \{[\s\S]*?\n\}/)
assertEqual(!!postMaisterBadgesMatch, true, '5. 前提: meister.gsからpostMaisterBadges関数を抽出できた')
var postMaisterBadgesSrc = postMaisterBadgesMatch ? postMaisterBadgesMatch[0] : ''
assertContains(postMaisterBadgesSrc, "message: '保存しました'", '5. postMaisterBadgesの保存成功メッセージが「保存しました」（スコアを含まない）になっている')
assertNotContains(postMaisterBadgesSrc, "'保存しました。スコア", '5. postMaisterBadgesの保存成功メッセージに旧・スコア付き文言が残っていない')
// score自体は戻り値のフィールドとして残ってよい（内部計算の既存互換性）ため、
// scoreキーの存在は否定しない。message文字列の中身だけを否定する

// ------------------------------------------------------------------
// 6. css.html: 表示専用の.skill-card__score、.meister-score、.judge-score-noteが残っていない
// ------------------------------------------------------------------
var cssHtml = readApp_('css.html')
assertNotContains(cssHtml, '.skill-card__score', '6. css.htmlに.skill-card__scoreの定義がない')
assertNotContains(cssHtml, '.meister-score', '6. css.htmlに.meister-scoreの定義がない')
assertNotContains(cssHtml, '.judge-score-note', '6. css.htmlに.judge-score-noteの定義がない')
// レビュー対応（個別点数表示の削除漏れ修正 2026-09-24）：表示要素を削除したmeister-item__pointsの
// CSSも合わせて削除されている。他クラス（meister-item__name等）の定義は引き続き残っていることも確認する
assertNotContains(cssHtml, '.meister-item__points', '6. css.htmlに.meister-item__pointsの定義がない')
assertContains(cssHtml, '.meister-item__name', '6. css.htmlの.meister-item__name（マイスター名のスタイル）は残っている')

// ------------------------------------------------------------------
// 7. view_home.html・view_detail.html・js_shift.html・js_judge.htmlのユーザー向け表示文言に、
//    「合計スコア」「旧基準」「現在のスコア」「技能点」が残っていないことの一括否定テスト
//    （HTMLコメント・レビュー対応の記録コメントは開発者向けであり店主が見る表示文言ではないため、
//    <script>タグの中身・テンプレート本体からJavaScriptコメント行を除いた実行コード相当と、
//    HTML本体を対象にする。ここでは「レビュー対応」を含む行はコメントとして除外する）
// ------------------------------------------------------------------
var FORBIDDEN_TERMS = ['合計スコア', '旧基準', '現在のスコア', '技能点']
var TARGET_FILES = ['view_home.html', 'view_detail.html', 'js_shift.html', 'js_judge.html']

/**
 *  <script>タグ内のJavaScriptコメント（行コメント// ...、ブロックコメント/* ... * /）を
 *  文字列リテラルは壊さずに取り除く簡易版（文字列内の//や/*は考慮しないが、このコードベースの
 *  表示文言は日本語の通常文字列であり、//や/*を文字列値として含まないため実用上問題ない）。
 *  これにより、開発者向けの経緯コメント（「レビュー対応」の有無を問わずすべてのコメント）を
 *  除外したうえで、実際にユーザーへ表示されるtextContent代入・HTML属性値・テンプレート出力
 *  部分だけを対象に禁止語チェックできる
 */
function stripJsComments_(source) {
  var noBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
  var noLineComments = noBlockComments
    .split('\n')
    .map(function (line) {
      var idx = line.indexOf('//')
      return idx === -1 ? line : line.slice(0, idx)
    })
    .join('\n')
  return noLineComments
}

for (var i = 0; i < TARGET_FILES.length; i++) {
  var fname = TARGET_FILES[i]
  var raw = readApp_(fname)
  // HTMLコメント（<!-- ... -->、view_home.htmlのレビュー対応コメント等）とJavaScriptコメントの
  // 両方を取り除いてから禁止語を調べる（js_shift.html・js_judge.htmlは<script>タグ内のみのため
  // HTMLコメントを含まないが、両方除去しても対象文言には影響しない）
  var noHtmlComments = raw.replace(/<!--[\s\S]*?-->/g, '')
  var src = stripJsComments_(noHtmlComments)
  for (var j = 0; j < FORBIDDEN_TERMS.length; j++) {
    var term = FORBIDDEN_TERMS[j]
    assertNotContains(src, term, '7. ' + fname + '（コメント除く）に「' + term + '」が残っていない')
  }
}

console.log('---')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
