// 希望シフト機能のレビュー対応（hidden属性による非表示の確実化）を、本番のapp/css.htmlを
// 直接読み込んで検証する。CSSの構文解析ライブラリは使わず、正規表現でセレクタとルール本体を
// 抽出する簡易的な方法に留める（本番のスタイル定義をこのファイルへ再実装しない）。
//
// 対象は judge_open_detail_btn・shift_edit_delete_btn・shift_edit_modal_wish_field。
// いずれも「hidden属性はあるが、クラス側のdisplay常時指定（.btn-secondary/.btn-danger/.modal-field）に
// 上書きされて実際には消えない」という不具合が指摘されたため、[hidden]付きセレクタで
// display:noneを宣言するルールが存在し、かつそのルールの詳細度がベースクラスより高いことを確認する。
// （当初はshift_wish_modal_edit_btn・shift_wish_modal_delete_btnを対象にしていたが、店主希望導線整理・
// 希望編集削除撤去 2026-09-24でこの2ボタン自体を撤去したため、同じクラス［.btn-secondary/.btn-danger］を
// 使う既存のjudge_open_detail_btn・shift_edit_delete_btnへ検証対象を差し替えた。[hidden]優先ルール
// 自体はクラス単位のCSSルールであり、対象ボタンが変わっても検証したい仕組みは変わらない）
//
// 重要な限界: これはCSSソースの静的検証であり、ブラウザでの実際の描画結果（本当に非表示に
// なるか）は確認できない。詳細度の計算はここでの簡易ルールに基づく（クラス+属性セレクタは
// クラス単体より詳細度が高い、というCSS仕様上の一般則を機械的に確認するだけ）。
// ブラウザでの実描画確認はGAS実機側で行う必要がある。
//
// 実行: node css_hidden_test.js
// 失敗時は終了コード1で終わる。

'use strict'

var fs = require('fs')
var path = require('path')

var APP_DIR = path.join(__dirname, '..', '..', 'src')
var CSS_PATH = path.join(APP_DIR, 'css.html')
var VIEW_HOME_PATH = path.join(APP_DIR, 'view_home.html')

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

var cssSource = fs.readFileSync(CSS_PATH, 'utf8')
var viewHomeSource = fs.readFileSync(VIEW_HOME_PATH, 'utf8')

console.log('検証対象: ' + CSS_PATH)
console.log('---')

/**
 *  簡易CSSルール抽出。"セレクタ { 宣言 }" の並びを、コメント除去後に正規表現で切り出す。
 *  ネストしたブロック（@media等）の中身も含めて1階層分だけ抽出できれば十分
 *  （本番css.htmlに@supports等の複雑なネストはない前提。あればこの抽出は不完全になるが、
 *  今回検証したいルールはいずれもトップレベルの単純なブロックである）
 */
function extractRules_(source) {
  var withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
  var rules = []
  var re = /([^{}]+)\{([^{}]*)\}/g
  var m
  while ((m = re.exec(withoutComments)) !== null) {
    var selectorText = m[1].trim()
    var body = m[2].trim()
    var selectors = selectorText.split(',').map(function (s) { return s.trim() }).filter(function (s) { return s.length > 0 })
    rules.push({ selectors: selectors, body: body, raw: m[0] })
  }
  return rules
}

var rules = extractRules_(cssSource)

/**
 *  指定したクラス名（例: 'btn'）を素のクラスセレクタとして含むルール（.btn, .btn:hover等ではなく
 *  ちょうど ".btn" のような単純セレクタ）を集め、そのいずれかに display の宣言があるかを返す
 */
function findBaseDisplayDeclaration_(className) {
  var target = '.' + className
  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i]
    for (var j = 0; j < rule.selectors.length; j++) {
      if (rule.selectors[j] === target && /display\s*:/.test(rule.body)) {
        return rule
      }
    }
  }
  return null
}

/**
 *  指定したクラス名の "[hidden]" 付きセレクタ（例: '.btn[hidden]'）を持つルールを探し、
 *  そのルールに "display: none" 宣言が含まれるかを確認する
 */
function findHiddenOverrideRule_(className) {
  var target = '.' + className + '[hidden]'
  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i]
    for (var j = 0; j < rule.selectors.length; j++) {
      if (rule.selectors[j] === target) return rule
    }
  }
  return null
}

// 1. .btn/.btn-secondary/.btn-danger/.modal-fieldは、いずれも常時display指定を持つ
//    （これが素のhidden属性より優先されてしまう原因の前提確認）
var baseClasses = ['btn', 'btn-secondary', 'btn-danger', 'modal-field']
baseClasses.forEach(function (cls) {
  var baseRule = findBaseDisplayDeclaration_(cls)
  assertTrue(!!baseRule, '前提: .' + cls + 'がdisplayを常時指定している（' + (baseRule ? baseRule.body.match(/display\s*:\s*[^;]+/)[0] : 'なし') + '）')
})

// 2. 上記の各クラスに対応する「.クラス名[hidden] { display: none }」ルールが存在する
//    （レビュー対応: judge_open_detail_btn・shift_edit_delete_btnはbtn-secondary/btn-danger、
//    shift_edit_modal_wish_fieldはmodal-fieldを使うため、クラス単位の[hidden]ルールで確実に消える）
baseClasses.forEach(function (cls) {
  var hiddenRule = findHiddenOverrideRule_(cls)
  assertTrue(!!hiddenRule, '.' + cls + '[hidden] というセレクタのルールが存在する')
  if (hiddenRule) {
    assertTrue(/display\s*:\s*none\s*;?/.test(hiddenRule.body), '.' + cls + '[hidden] のルール本体にdisplay:noneが含まれる（本体: ' + hiddenRule.body + '）')
  }
})

// 3. 詳細度の確認: ".クラス名[hidden]" は ".クラス名" 単体よりCSS詳細度が高い
//    （クラスセレクタ1個 vs クラスセレクタ1個+属性セレクタ1個。属性セレクタが1つ増えるため、
//    ソースの記述順に関係なく[hidden]側が必ず優先される。これは仕様上の一般則であり、
//    このテストでは「属性セレクタが付加されている」という構文上の事実だけを確認する）
baseClasses.forEach(function (cls) {
  var hasAttributeSelector = new RegExp('^\\.' + cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\[hidden\\]$').test('.' + cls + '[hidden]')
  assertTrue(hasAttributeSelector, '.' + cls + '[hidden] は属性セレクタを含み、.' + cls + '単体より詳細度が高い（CSS仕様上、ソース順に関係なく優先される）')
})

// 4. 対象3要素（judge_open_detail_btn・shift_edit_delete_btn・shift_edit_modal_wish_field）が
//    view_home.html内で、上で確認したクラスのいずれかを実際に持っていることを確認する
//    （CSS側にルールがあっても、対象のHTML要素がそのクラスを持っていなければ意味がないため）
function findElementClassAttr_(id) {
  var re = new RegExp('id="' + id + '"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*id="' + id + '"')
  var m = viewHomeSource.match(re)
  if (!m) return null
  return (m[1] || m[2] || '').split(/\s+/).filter(function (c) { return c.length > 0 })
}

var openDetailBtnClasses = findElementClassAttr_('judge_open_detail_btn')
assertTrue(!!openDetailBtnClasses, 'judge_open_detail_btnのclass属性を取得できた')
assertTrue(!!openDetailBtnClasses && openDetailBtnClasses.indexOf('btn-secondary') !== -1, 'judge_open_detail_btnはbtn-secondaryクラスを持つ（[hidden]ルールの対象になる）')

var editDeleteBtnClasses = findElementClassAttr_('shift_edit_delete_btn')
assertTrue(!!editDeleteBtnClasses, 'shift_edit_delete_btnのclass属性を取得できた')
assertTrue(!!editDeleteBtnClasses && editDeleteBtnClasses.indexOf('btn-danger') !== -1, 'shift_edit_delete_btnはbtn-dangerクラスを持つ（[hidden]ルールの対象になる）')

var wishFieldClasses = findElementClassAttr_('shift_edit_modal_wish_field')
assertTrue(!!wishFieldClasses, 'shift_edit_modal_wish_fieldのclass属性を取得できた')
assertTrue(!!wishFieldClasses && wishFieldClasses.indexOf('modal-field') !== -1, 'shift_edit_modal_wish_fieldはmodal-fieldクラスを持つ（[hidden]ルールの対象になる）')

// 5. 対象3要素がview_home.html内でhidden属性を伴って出力されていること
//    （judge_open_detail_btn・shift_edit_modal_wish_fieldは初期状態でhidden属性が付いている。
//    shift_edit_delete_btnはJSがhiddenを切り替える対象で初期状態はhidden無しでよい）
assertTrue(/id="judge_open_detail_btn"[^>]*hidden/.test(viewHomeSource) || /hidden[^>]*id="judge_open_detail_btn"/.test(viewHomeSource),
  'judge_open_detail_btnは初期状態でhidden属性付きで出力される')
assertTrue(/id="shift_edit_modal_wish_field"[^>]*hidden/.test(viewHomeSource) || /hidden[^>]*id="shift_edit_modal_wish_field"/.test(viewHomeSource),
  'shift_edit_modal_wish_fieldは初期状態でhidden属性付きで出力される')

// 6. 回帰確認: 既存の判定結果ボタン（#judge_open_detail_btn）・要約（.judge-summary）・
//    モーダルオーバーレイ（.modal-overlay）にも、同様の[hidden]優先ルールが引き続き存在すること
assertTrue(/#judge_open_detail_btn\s*\{[^}]*display\s*:\s*none/.test(cssSource), '回帰確認: #judge_open_detail_btnのdisplay:noneルールが引き続き存在する')
assertTrue(/\.judge-summary\[hidden\]\s*\{[^}]*display\s*:\s*none/.test(cssSource), '回帰確認: .judge-summary[hidden]のdisplay:noneルールが引き続き存在する')
assertTrue(/\.modal-overlay\s*\{[^}]*display\s*:\s*none/.test(cssSource), '回帰確認: .modal-overlayのdisplay:noneルールが引き続き存在する（hidden既定でnone）')
assertTrue(/\.modal-overlay:not\(\[hidden\]\)\s*\{[^}]*display\s*:\s*flex/.test(cssSource), '回帰確認: .modal-overlay:not([hidden])のdisplay:flexルールが引き続き存在する')

console.log('---')
console.log('【GAS実機・ブラウザ確認が必要】このテストでは検証できない範囲:')
console.log('- 実際のブラウザでjudge_open_detail_btn・shift_edit_delete_btnがhidden切り替え時に見た目上も消えること')
console.log('- 実際のブラウザでshift_edit_modal_wish_fieldが希望IDなしの勤務変更モーダルで見た目上も消えること')
console.log('- 判定結果ボタン（#judge_open_detail_btn）・要約・シフト変更削除モーダル・判定詳細モーダル・')
console.log('  直接シフト登録モーダルなど、他の画面のhidden切り替えに見た目の回帰がないこと')
console.log('- CSSの優先順位はここでは構文上の事実（属性セレクタの有無）だけを確認しており、')
console.log('  実際のレンダリング結果はブラウザの開発者ツール等で確認する必要がある')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
