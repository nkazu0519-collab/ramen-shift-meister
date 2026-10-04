// レビュー対応（2つのモーダルの改善、再レビューでの修正 2026-09-16）：
// ①直接シフト登録モーダルは、従業員選択後のマイスター詳細（employee_skill_card）が展開されると
//   縦長になり、下部の登録ボタンが押しづらくなる問題があった。.modal--form-scrollを重ね、
//   モーダル自体を「見出し＋本文スクロール（.modal-body-scroll）＋常に見える操作領域
//   （.modal-actions）」の3段構成にした。マイスター詳細は初期状態で閉じ、
//   「マイスター情報を見る」ボタン（shift_skill_toggle_btn）で開閉する。
// ②シフトの変更・削除モーダルは、従業員名の横に取得マイスターのラベル（skill-tag-list--inline）を
//   表示できるようにした。収まらない分は「＋N件」ボタン（shift_edit_skill_more_btn）で
//   詳細行（shift_edit_modal_skill_detail_field）を開閉する。
//
// 再レビューで見つかった3件の指摘とその修正：
// 1. .skill-tag・.skill-tag-more-btn・.skill-toggle-btnはdisplayをクラスセレクタで常時指定して
//    おり、要素のhidden属性だけでは非表示にならない（クラスセレクタと[hidden]のUAスタイルは
//    詳細度が同じでソース順が勝つため。既存の.btn[hidden]等と同じ理由・同じ対策）。
//    3つのクラスそれぞれに[hidden]優先ルール（display: none）を追加した。
// 2. shiftEditSkillInlineLimit_による固定3件／1件では「名前の横に収まる分だけ」という仕様を
//    満たさないため削除し、recalculateShiftEditSkillInlineVisibility_でgetBoundingClientRect()に
//    よる実幅計測へ置き換えた（js_shift.html側。ロジック自体の検証はshift_modal_skill_display_test.js）。
//    計測中は.skill-tag-list--measuringでflex-wrapを止め、折り返しによる誤判定を防ぐ。
//    詳細行（.skill-tag-list--detail）は長い名称でも折り返して全文を読めるようにした。
// 3. シフトの変更・削除モーダルにも、直接シフト登録モーダルと同じ.modal--form-scroll・
//    .modal-body-scrollを適用し、本文が伸びても変更・削除・キャンセルが画面内に残るようにした。
//
// さらに再レビューで見つかった指摘（幅計算に残る問題、2026-09-16）とその修正：
// recalculateShiftEditSkillInlineVisibility_はラベル列内部だけをnowrap化して計測していたが、
// 親の.modal-field--wrapはflex-wrap: wrapのままで、ラベル列自体（flex: 1 1 auto）が
// 全タグ挿入時に行ごと2行目へ折り返ることがあった。その場合、計測は「名前の横の残り幅」ではなく
// 「折り返った別行の幅」を対象にしてしまい、多段化を防げていなかった。
// 修正：.modal-field--wrapをflex-wrap: nowrapに固定し、「＋N件」ボタンはflex: 0 0 autoのまま、
// ラベル列（.skill-tag-list--inline）はflex: 1 1 auto; min-width: 0; overflow: hiddenで
// 「名前・ボタンを除いた残り幅」に固定されるようにした。
//
// さらにその後の指摘（幅計算に残る問題2、2026-09-16）とその修正：
// 名前（.modal-field__value）をflex-shrink: 0; max-width: 60%にしていたため、狭い画面で
// 氏名が長いと「名前(60%)＋ラベル列(0まで縮小可能)＋＋N件ボタン＋gap」の合計が行幅を超えても
// 名前自体が一切縮まず、行からはみ出していた。修正：名前もflex-shrink: 1（既定）で縮められる
// ようにし、min-width: 3remだけ最低限の可読幅として残す。縮んだ結果溢れる分は
// overflow-wrap: anywhereで空白のない長い英字名も強制的に折り返す。
//
// レビュー対応（希望シフトモーダルへのマイスターラベル追加 2026-09-16）：
// 「希望シフトから勤務を登録」モーダル（shift_wish_modal）にも、シフトの変更・削除モーダルと
// 同じ方式（.modal--form-scroll・.modal-body-scroll、名前横の常時表示ラベル列＋「＋N件」展開）で
// マイスターラベルを追加した。要素IDはshift_edit_modal側と別のもの（shift_wish_modal_skill_tags・
// shift_wish_skill_more_btn）を使い、混線しないようにしている。
// 表示ロジック自体（実幅計測・「＋N件」開閉・リサイズ追従）はjs_shift.htmlの共通関数へ切り出し、
// shift_edit_modal・shift_wish_modalの両方から専用のui（createSkillTagUI_インスタンス）を
// 介して呼ぶ構成にした（ロジック自体の検証はshift_modal_skill_display_test.js・
// shift_wish_modal_skill_display_test.jsで行う）。CSS（.modal-field--wrap・
// .skill-tag-list--inline・.skill-tag-more-btn等）はshift_edit_modalと共有するため、
// このモーダル専用の新規CSSは追加していない。
//
// レビュー対応（展開表示の重複解消 2026-09-16）：「＋N件」を押すと、名前横に表示済みの
// ラベルまで別行の「全マイスター」（shift_edit_modal_skill_detail_field・
// shift_edit_modal_skill_detail_tags、shift_wish_modal側も同様）に再表示され、情報が
// 重複していた。修正：別行の「全マイスター」（両モーダルとも）を廃止し、名前横のラベル列
// （skill-tag-list--inline）自体が折りたたみ・展開の両方を担う設計へ変更した。
// - 折りたたみ時：実幅に収まるラベルと「＋N件」を表示する（従来どおり）。
// - 展開時：同じラベル列へ隠れていた分を追加し、各ラベルを1回だけ表示する。収まらなければ
//   折り返す（CSS: .skill-tag-list--expandedでoverflow: visible・flex-wrap: wrapに切り替え、
//   親行にも.modal-field--wrap-expandedでflex-wrap: wrapを許可する）。ボタンは「折りたたむ」
//   に変わる。
// - 折りたたむと、その時点の幅で表示件数・残り件数を再計算する（recalculateSkillInlineVisibility_
//   を呼び直す）。全件収まる場合は「＋N件」を表示しない。
// - 展開中はリサイズハンドラがrecalculateSkillInlineVisibility_自体を呼ばない
//   （ui.expandedで判定）ため、展開中のリサイズで意図せず折りたたまれない。
// aria-controlsは、廃止した詳細行ではなくラベル列自身（inlineList）を指すよう変更した。
// wrapField（従業員名の行、shift_edit_modal_skill_wrap・shift_wish_modal_skill_wrap）を
// 新規のid付き要素として追加し、js_shift.html側のui.ids.wrapFieldから参照する
// （展開時にflex-wrap: wrapを付け外しする対象のため）。
//
// このテストでは、view_home.html・css.htmlの静的なHTML/CSS構造を確認する。「文字列検査が
// 通るだけで描画確認済みとしない」という方針に沿い、CSSはshift_card_date_nav_test.js等と
// 同じ簡易パーサ（parseCssRules_）でブロック単位にパースし、宣言の有無を機械的に検証する。
// 実際のブラウザでのモーダルの高さ・スクロール挙動・ラベルの折り返し・実際に計算されたCSSの
// 描画結果（[hidden]優先ルールがあることの確認はできても、それが実際に非表示として描画される
// ことまではこのテストでは確認できない）はこのテストの対象外。
//
// マイスター表示ロジック自体（開閉・実幅計測・件数表記・リサイズ再計算・イベント登録重複防止）の
// 検証はshift_modal_skill_display_test.js（共通ロジック・shift_edit_modal側）・
// shift_wish_modal_skill_display_test.js（shift_wish_modal側）で行う。
//
// 実行: node shift_modal_scroll_structure_test.js
// 失敗時は終了コード1で終わる。

'use strict'

var fs = require('fs')
var path = require('path')

var APP_DIR = path.join(__dirname, '..', '..', 'src')
var home = fs.readFileSync(path.join(APP_DIR, 'view_home.html'), 'utf8')
var css = fs.readFileSync(path.join(APP_DIR, 'css.html'), 'utf8')

var pass = 0
var fail = 0
function assertTrue(value, label) {
  var ok = !!value
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label)
  if (ok) pass++; else fail++
}

/**
 *  <style>〜</style>の中身を、メディアクエリの内外を区別しながら「トップレベルのルール」と
 *  「メディアクエリ内のルール」に簡易パースする（他のテストファイルと同じ自己完結の実装。
 *  ファイルごとに再実装する既存の慣習に合わせ、共通モジュール化はしない）
 */
function parseCssRules_(cssText) {
  var body = cssText.replace(/^[\s\S]*?<style>/, '').replace(/<\/style>[\s\S]*$/, '')
  body = body.replace(/\/\*[\s\S]*?\*\//g, '')

  var rules = []
  var i = 0
  var mediaStack = []

  while (i < body.length) {
    var openIdx = body.indexOf('{', i)
    var closeIdx = body.indexOf('}', i)
    if (openIdx === -1 && closeIdx === -1) break

    if (closeIdx !== -1 && (openIdx === -1 || closeIdx < openIdx)) {
      if (mediaStack.length > 0) mediaStack.pop()
      i = closeIdx + 1
      continue
    }

    var head = body.slice(i, openIdx).trim()
    if (head.indexOf('@media') === 0) {
      mediaStack.push(head)
      i = openIdx + 1
      continue
    }

    var declClose = body.indexOf('}', openIdx)
    var declarationsText = body.slice(openIdx + 1, declClose)
    rules.push({
      selector: head,
      declarationsText: declarationsText,
      mediaCondition: mediaStack.length > 0 ? mediaStack[mediaStack.length - 1] : null
    })
    i = declClose + 1
  }

  return rules
}

var cssRules = parseCssRules_(css)
assertTrue(cssRules.length > 50, 'CSSルールを簡易パースできた（' + cssRules.length + '件のルールを検出）')

/**
 *  カンマ区切りの複数セレクタをまとめて定義したルール（例：".a, .b { ... }"）も対象に含めて検索する
 */
function findRulesContainingSelector_(rules, selectorExact) {
  return rules.filter(function (r) {
    var parts = r.selector.split(',').map(function (s) { return s.trim() })
    return parts.indexOf(selectorExact) !== -1
  })
}
function declares_(declarationsText, propertyNamePattern) {
  return new RegExp('(^|;)\\s*' + propertyNamePattern + '\\s*:').test(declarationsText)
}

console.log('---')
console.log('検証対象1: 直接シフト登録モーダルの構造（マイスター詳細の折りたたみ・本文スクロール）')
console.log('---')

// ------------------------------------------------------------------
// HTML構造：view_home.html
// ------------------------------------------------------------------
assertTrue(/id="shift_direct_add_modal"/.test(home), 'shift_direct_add_modalが存在する')
assertTrue(/class="modal modal--form-scroll"/.test(home), 'shift_direct_add_modal内の.modalに.modal--form-scroll修飾クラスが重ねてある')
assertTrue(/class="modal-body-scroll"/.test(home), '.modal-body-scroll（本文スクロール領域）が存在する')

// マイスター詳細の折りたたみボタン・詳細card自体が、本文スクロール領域の中に含まれていること
// （それぞれの出現位置で判定：modal-body-scrollの開始位置より後に出現するか）
{
  var bodyScrollIdx = home.indexOf('class="modal-body-scroll"')
  var toggleBtnIdx = home.indexOf('id="shift_skill_toggle_btn"')
  var skillCardIdx = home.indexOf('id="employee_skill_card"')
  var actionsIdx = home.indexOf('id="shift_submit_btn"')
  assertTrue(bodyScrollIdx !== -1 && toggleBtnIdx > bodyScrollIdx, '「マイスター情報を見る」ボタン（shift_skill_toggle_btn）は.modal-body-scrollの内側にある')
  assertTrue(bodyScrollIdx !== -1 && skillCardIdx > bodyScrollIdx, 'employee_skill_cardは.modal-body-scrollの内側にある')
  assertTrue(actionsIdx !== -1 && toggleBtnIdx < actionsIdx, '「マイスター情報を見る」ボタンは登録ボタン（shift_submit_btn）より前（本文側）に出現する')
}

// トグルボタン・マイスター詳細cardが、HTML上の初期状態でhidden属性を持つこと
// （マイスター詳細は初期状態で閉じる。トグルボタン自体は従業員未選択時に隠す既定と一致する）
{
  var toggleBtnTagMatch = home.match(/<button type="button" id="shift_skill_toggle_btn"[^>]*>/)
  var skillCardTagMatch = home.match(/<div id="employee_skill_card"[^>]*>/)
  assertTrue(!!toggleBtnTagMatch && /\bhidden\b/.test(toggleBtnTagMatch[0]), 'shift_skill_toggle_btnはHTML上の初期状態でhidden属性を持つ（従業員未選択時は表示しない）')
  assertTrue(!!skillCardTagMatch && /\bhidden\b/.test(skillCardTagMatch[0]), 'employee_skill_cardはHTML上の初期状態でhidden属性を持つ（マイスター詳細は初期状態で閉じる）')
  assertTrue(!!toggleBtnTagMatch && /aria-expanded="false"/.test(toggleBtnTagMatch[0]), 'shift_skill_toggle_btnはaria-expanded="false"で開始する')
  assertTrue(!!toggleBtnTagMatch && /aria-controls="employee_skill_card"/.test(toggleBtnTagMatch[0]), 'shift_skill_toggle_btnのaria-controlsはemployee_skill_cardを指す')
  assertTrue(!!toggleBtnTagMatch && /type="button"/.test(toggleBtnTagMatch[0]), 'shift_skill_toggle_btnはtype="button"（フォーム誤送信を起こさない）')
}

// 登録・キャンセルボタン（.modal-actions）は本文スクロール領域の外にあること
{
  var bodyScrollCloseIdx = home.indexOf('</div>', home.indexOf('class="modal-body-scroll"'))
  var modalActionsIdx = home.indexOf('class="modal-actions"', home.indexOf('id="shift_direct_add_modal"'))
  assertTrue(modalActionsIdx !== -1 && modalActionsIdx > home.indexOf('id="shift_submit_message"'), 'modal-actions（登録・キャンセル）はエラーメッセージ領域より後に出現する（操作領域が本文を覆う配置ではない）')
}

// ------------------------------------------------------------------
// CSS構造：.modal--form-scroll・.modal-body-scroll
// ------------------------------------------------------------------
{
  var formScrollRules = findRulesContainingSelector_(cssRules, '.modal--form-scroll')
  var topLevelFormScroll = formScrollRules.filter(function (r) { return !r.mediaCondition })
  assertTrue(topLevelFormScroll.length > 0, '.modal--form-scrollのトップレベルルールが存在する')
  var hasMaxHeight = topLevelFormScroll.some(function (r) { return declares_(r.declarationsText, 'max-height') })
  assertTrue(hasMaxHeight, '.modal--form-scrollはmax-height（画面高に収める上限）を持つ')
  var hasFlexColumn = topLevelFormScroll.some(function (r) { return /display\s*:\s*flex/.test(r.declarationsText) && /flex-direction\s*:\s*column/.test(r.declarationsText) })
  assertTrue(hasFlexColumn, '.modal--form-scrollはdisplay:flex; flex-direction:columnを持つ（見出し・本文・操作領域を縦に積む構成）')
}
{
  var bodyScrollRules = findRulesContainingSelector_(cssRules, '.modal-body-scroll')
  var topLevelBodyScroll = bodyScrollRules.filter(function (r) { return !r.mediaCondition })
  assertTrue(topLevelBodyScroll.length > 0, '.modal-body-scrollのトップレベルルールが存在する')
  var hasOverflowY = topLevelBodyScroll.some(function (r) { return /overflow-y\s*:\s*auto/.test(r.declarationsText) })
  assertTrue(hasOverflowY, '.modal-body-scrollはoverflow-y: autoを持つ（本文だけがスクロールする）')
}
{
  // .modal--form-scroll .modal-actionsがflex: 0 0 autoを持つこと
  // （本文がスクロールしても、操作領域はflexアイテムとして縮められず常に画面内に残る）
  var actionsFixedRules = cssRules.filter(function (r) {
    return r.selector === '.modal--form-scroll .modal-actions' && !r.mediaCondition
  })
  assertTrue(actionsFixedRules.length > 0, '.modal--form-scroll .modal-actionsのルールが存在する')
  var hasFlexNoShrink = actionsFixedRules.some(function (r) { return /flex\s*:\s*0\s+0\s+auto/.test(r.declarationsText) })
  assertTrue(hasFlexNoShrink, '.modal--form-scroll .modal-actionsはflex: 0 0 autoを持つ（本文スクロール時も操作領域が縮まない）')
}

console.log('---')
console.log('検証対象2: シフトの変更・削除モーダルの構造（従業員名の下段のマイスターラベル・本文スクロール化）')
console.log('---')

// ------------------------------------------------------------------
// HTML構造（指摘3対応）：shift_edit_modalにも.modal--form-scroll・.modal-body-scrollが
// 適用されていること（このモーダルは<form>を持たない点が直接シフト登録モーダルと異なる）
// ------------------------------------------------------------------
{
  var editModalTagMatch = home.match(/<div id="shift_edit_modal"[^>]*>[\s\S]*?<div class="modal[^"]*"/)
  assertTrue(!!editModalTagMatch && /class="modal modal--form-scroll"/.test(editModalTagMatch[0]), 'shift_edit_modal内の.modalに.modal--form-scroll修飾クラスが重ねてある（指摘3対応）')
}
{
  // shift_edit_modal内の.modal-body-scrollが、従業員名・ラベル・時刻入力・エラーメッセージを
  // 含み、かつmodal-actions（変更・削除・キャンセル）より前で終わっていること
  var editModalStart = home.indexOf('id="shift_edit_modal"')
  var editModalBodyScrollIdx = home.indexOf('class="modal-body-scroll"', editModalStart)
  var editEmployeeFieldIdx = home.indexOf('id="shift_edit_modal_employee"', editModalStart)
  var editMessageIdx = home.indexOf('id="shift_edit_modal_message"', editModalStart)
  var editActionsIdx = home.indexOf('class="modal-actions"', editModalStart)
  assertTrue(editModalBodyScrollIdx !== -1 && editModalBodyScrollIdx < editEmployeeFieldIdx, 'shift_edit_modalの.modal-body-scrollは従業員名フィールドより前から始まる（本文全体を囲む）')
  assertTrue(editMessageIdx !== -1 && editActionsIdx !== -1 && editMessageIdx < editActionsIdx, 'shift_edit_modal_message（エラーメッセージ）はmodal-actionsより前に出現する（操作領域が本文を覆わない）')
}

// ------------------------------------------------------------------
// HTML構造：view_home.html
// レビュー対応（従業員名の下へマイスターラベルを配置 2026-09-21）：以前は氏名と同じ行
// （modal-field--wrap）にラベル列・「＋N件」ボタンを並べ、幅を奪い合って氏名が不自然に
// 改行される問題があった。氏名は通常の.modal-field（ラベル＋値のみ）に戻し、マイスターラベルは
// 氏名の下の別行（modal-field--skill-row、id=shift_edit_modal_skill_wrapのまま据え置き）へ移した。
// マイスター情報がない場合に不要な空行を残さないよう、ラベル行はHTML上の初期状態でもhidden属性を
// 持つ（JS側のrenderSkillTags_が実際にラベルを追加する場合だけhidden=falseへ戻す）
// ------------------------------------------------------------------
assertTrue(/id="shift_edit_modal_skill_wrap"/.test(home), 'shift_edit_modal_skill_wrap（マイスターラベルの行、展開時にflex-wrap: wrapを付け外しする対象）が存在する')
assertTrue(/id="shift_edit_modal_skill_tags"/.test(home), 'shift_edit_modal_skill_tags（常時表示ラベル列。展開時はここへ隠れていた分を追加する）が存在する')
assertTrue(/id="shift_edit_skill_more_btn"/.test(home), 'shift_edit_skill_more_btn（「＋N件」／「折りたたむ」ボタン）が存在する')
assertTrue(home.indexOf('id="shift_edit_modal_skill_detail_field"') === -1, 'shift_edit_modal_skill_detail_field（旧・別行の全マイスター）はもう存在しない（展開表示の重複解消対応）')
assertTrue(home.indexOf('id="shift_edit_modal_skill_detail_tags"') === -1, 'shift_edit_modal_skill_detail_tags（旧・詳細行内の全マイスターラベル）はもう存在しない（展開表示の重複解消対応）')

{
  // 氏名の行は、ラベル列・ボタンを含まない通常の.modal-field（従業員ラベル＋氏名の値のみ）
  var editModalStart2 = home.indexOf('id="shift_edit_modal"')
  var editNameFieldMatch = home.slice(editModalStart2).match(/<p class="modal-field"><span class="modal-field__label">従業員<\/span><span id="shift_edit_modal_employee" class="modal-field__value"><\/span><\/p>/)
  assertTrue(!!editNameFieldMatch, '氏名の行は通常の.modal-field（ラベル＋値のみ）で、ラベル列・「＋N件」ボタンを含まない（氏名がラベルと幅を奪い合わない）')
}
{
  var skillRowMatch = home.match(/<p class="modal-field modal-field--skill-row" id="shift_edit_modal_skill_wrap" hidden>[\s\S]*?<\/p>/)
  assertTrue(!!skillRowMatch, 'マイスターラベルの行（modal-field--skill-row、id=shift_edit_modal_skill_wrap）が存在し、HTML上の初期状態でhidden属性を持つ（不要な空行を残さない）')
  if (skillRowMatch) {
    var skillRowHtml = skillRowMatch[0]
    assertTrue(skillRowHtml.indexOf('shift_edit_modal_skill_tags') !== -1, 'マイスターラベルの行にラベル列（shift_edit_modal_skill_tags）が含まれる')
    assertTrue(skillRowHtml.indexOf('shift_edit_skill_more_btn') !== -1, 'マイスターラベルの行に「＋N件」ボタンが含まれる')
    assertTrue(skillRowHtml.indexOf('shift_edit_modal_employee') === -1, 'マイスターラベルの行に氏名（shift_edit_modal_employee）は含まれない（氏名行とは別要素）')
  }
}
{
  var moreBtnTagMatch = home.match(/<button type="button" id="shift_edit_skill_more_btn"[^>]*>/)
  assertTrue(!!moreBtnTagMatch && /\bhidden\b/.test(moreBtnTagMatch[0]), 'shift_edit_skill_more_btnはHTML上の初期状態でhidden属性を持つ（隠れているラベルがなければ出さない）')
  assertTrue(!!moreBtnTagMatch && /type="button"/.test(moreBtnTagMatch[0]), 'shift_edit_skill_more_btnはtype="button"（フォーム誤送信を起こさない。このモーダルはform要素を持たないが、共通条件として明示する）')
  // レビュー対応（展開表示の重複解消 2026-09-16）：aria-controlsは、廃止した詳細行ではなく
  // 展開対象であるラベル列自身（shift_edit_modal_skill_tags）を指すよう変更した
  assertTrue(!!moreBtnTagMatch && /aria-controls="shift_edit_modal_skill_tags"/.test(moreBtnTagMatch[0]), 'shift_edit_skill_more_btnのaria-controlsは展開対象のラベル列自身（shift_edit_modal_skill_tags）を指す')
}

// 展開時にも変更・削除・キャンセルへ到達できる（HTML上の出現順で、ラベル列自体はmodal-actionsより
// 前にあり、別要素を新設せず同じ要素の中身が変わるだけなので、DOM構造自体は展開前後で変わらない）
{
  var inlineListIdx = home.indexOf('id="shift_edit_modal_skill_tags"')
  var editActionsIdx = home.indexOf('id="shift_edit_save_btn"', home.indexOf('id="shift_edit_modal"'))
  assertTrue(inlineListIdx !== -1 && editActionsIdx !== -1 && inlineListIdx < editActionsIdx, 'ラベル列（shift_edit_modal_skill_tags）は変更・削除・キャンセルボタンより前のDOM順にあり、展開してもボタン自体は別要素としてそのままDOM上に残る')
}

// ------------------------------------------------------------------
// CSS構造：.skill-tag-list--inline・.skill-tag-more-btn・.modal-field--skill-row
// ------------------------------------------------------------------
{
  var inlineListRules = findRulesContainingSelector_(cssRules, '.skill-tag-list--inline')
  var topLevelInline = inlineListRules.filter(function (r) { return !r.mediaCondition })
  assertTrue(topLevelInline.length > 0, '.skill-tag-list--inlineのトップレベルルールが存在する')
  var hasMinWidth0 = topLevelInline.some(function (r) { return /min-width\s*:\s*0/.test(r.declarationsText) })
  assertTrue(hasMinWidth0, '.skill-tag-list--inlineはmin-width: 0を持つ（flexアイテムとして縮小でき、「＋N件」ボタンを押し出して横にはみ出させない）')
  // レビュー対応（幅計算の再レビュー対応 2026-09-16）：overflow: hiddenがないと、タグを
  // 全件挿入した際にこのラベル列自身の内容サイズが要求され、幅が「「＋N件」ボタンを除いた
  // 残り幅」を超えて広がってしまう（それに伴い親.modal-field--skill-rowが折り返される
  // 原因になっていた）
  var hasOverflowHidden = topLevelInline.some(function (r) { return /overflow\s*:\s*hidden/.test(r.declarationsText) })
  assertTrue(hasOverflowHidden, '.skill-tag-list--inlineはoverflow: hiddenを持つ（タグを全件挿入してもコンテナ自身の幅が内容量に応じて広がらない、指摘2再修正対応）')
}
{
  var moreBtnRules = findRulesContainingSelector_(cssRules, '.skill-tag-more-btn')
  assertTrue(moreBtnRules.length > 0, '.skill-tag-more-btn（「＋N件」ボタン）のCSSルールが存在する')
  var topLevelMoreBtn = moreBtnRules.filter(function (r) { return !r.mediaCondition && r.selector === '.skill-tag-more-btn' })
  var hasFlexNoShrinkMoreBtn = topLevelMoreBtn.some(function (r) { return /flex\s*:\s*0\s+0\s+auto/.test(r.declarationsText) })
  assertTrue(hasFlexNoShrinkMoreBtn, '.skill-tag-more-btnはflex: 0 0 autoを持つ（ラベル列と同じ行で自分のサイズを保ち、行の配置が安定する）')
}
{
  // レビュー対応（従業員名の下へマイスターラベルを配置 2026-09-21）：ラベル行
  // （.modal-field--skill-row）はラベル列・「＋N件」ボタンだけを含み、氏名は含まない。
  // 行自体はnowrapに固定し、狭い画面・多数のラベルへの対応はラベル列側
  // （overflow: hiddenで0件まで縮む）に委ねる（旧.modal-field--wrapと同じ考え方）
  var wrapFieldRules = findRulesContainingSelector_(cssRules, '.modal-field--skill-row')
  var topLevelWrapField = wrapFieldRules.filter(function (r) { return !r.mediaCondition && r.selector === '.modal-field--skill-row' })
  var hasFlexNowrap = topLevelWrapField.some(function (r) { return /flex-wrap\s*:\s*nowrap/.test(r.declarationsText) })
  assertTrue(hasFlexNowrap, '.modal-field--skill-rowはflex-wrap: nowrapを持つ（ラベル列・「＋N件」ボタンの行が別行へ折り返らない）')
  var hasFlexWrapOld = topLevelWrapField.some(function (r) { return /flex-wrap\s*:\s*wrap[^-]/.test(r.declarationsText + ' ') && !/nowrap/.test(r.declarationsText) })
  assertTrue(!hasFlexWrapOld, '.modal-field--skill-rowはflex-wrap: wrap（折り返し）を持たない（折りたたみ時の既定はnowrap）')
}
{
  // レビュー対応（従業員名の下へマイスターラベルを配置 2026-09-21）：氏名がラベル列・
  // 「＋N件」ボタンと幅を奪い合わなくなったため、旧.modal-field--wrap .modal-field__value
  // （flex-shrink: 1・min-width: 3rem等）の指定は不要になった。氏名は通常の
  // .modal-field__valueのままで、空白のない長い英字名対策のoverflow-wrap: anywhereだけを
  // 全体（.modal-field__value）に残す
  var oldValueInWrapRules = cssRules.filter(function (r) { return r.selector === '.modal-field--wrap .modal-field__value' })
  assertTrue(oldValueInWrapRules.length === 0, '旧.modal-field--wrap .modal-field__value（氏名の縮小・min-width指定）はもう存在しない（氏名行の幅の奪い合いがなくなったため不要）')

  var valueRules = cssRules.filter(function (r) { return r.selector === '.modal-field__value' && !r.mediaCondition })
  assertTrue(valueRules.length > 0, '.modal-field__valueのルールが存在する')
  var hasOverflowWrapAnywhere = valueRules.some(function (r) { return /overflow-wrap\s*:\s*anywhere/.test(r.declarationsText) })
  assertTrue(hasOverflowWrapAnywhere, '.modal-field__valueはoverflow-wrap: anywhereを持つ（空白のない長い英字氏名でも横にはみ出さず折り返す）')
}

// 既存の.skill-tag（マイスターラベルの見た目）自体は変更していないこと（回帰確認）。
// white-space: nowrapを保持しており、ラベル1件が折り返しで縦に割れて読みにくくなることはない
{
  var skillTagRules = findRulesContainingSelector_(cssRules, '.skill-tag')
  var topLevelSkillTag = skillTagRules.filter(function (r) { return !r.mediaCondition })
  assertTrue(topLevelSkillTag.length > 0, '.skill-tagの既存ルールが引き続き存在する（変更していない）')
  var hasNowrap = topLevelSkillTag.some(function (r) { return /white-space\s*:\s*nowrap/.test(r.declarationsText) })
  assertTrue(hasNowrap, '.skill-tagはwhite-space: nowrapを維持している（ラベル内で折り返さない）')
}

// ------------------------------------------------------------------
// CSS構造（指摘1対応）：.skill-tag・.skill-tag-more-btn・.skill-toggle-btnの[hidden]優先ルール
// ------------------------------------------------------------------
{
  var skillTagHiddenRules = cssRules.filter(function (r) { return r.selector === '.skill-tag[hidden]' && !r.mediaCondition })
  assertTrue(skillTagHiddenRules.length > 0, '.skill-tag[hidden]のルールが存在する（指摘1対応）')
  var skillTagHiddenIsNone = skillTagHiddenRules.some(function (r) { return /display\s*:\s*none/.test(r.declarationsText) })
  assertTrue(skillTagHiddenIsNone, '.skill-tag[hidden]はdisplay: noneを持つ（実幅計測で隠したラベルが実際に非表示になる）')
}
{
  var moreBtnHiddenRules = cssRules.filter(function (r) { return r.selector === '.skill-tag-more-btn[hidden]' && !r.mediaCondition })
  assertTrue(moreBtnHiddenRules.length > 0, '.skill-tag-more-btn[hidden]のルールが存在する（指摘1対応）')
  var moreBtnHiddenIsNone = moreBtnHiddenRules.some(function (r) { return /display\s*:\s*none/.test(r.declarationsText) })
  assertTrue(moreBtnHiddenIsNone, '.skill-tag-more-btn[hidden]はdisplay: noneを持つ（超過ラベルがない場合、「＋N件」ボタンが実際に見えずTab対象にもならない）')
}
{
  var toggleBtnHiddenRules = cssRules.filter(function (r) { return r.selector === '.skill-toggle-btn[hidden]' && !r.mediaCondition })
  assertTrue(toggleBtnHiddenRules.length > 0, '.skill-toggle-btn[hidden]のルールが存在する（指摘1対応）')
  var toggleBtnHiddenIsNone = toggleBtnHiddenRules.some(function (r) { return /display\s*:\s*none/.test(r.declarationsText) })
  assertTrue(toggleBtnHiddenIsNone, '.skill-toggle-btn[hidden]はdisplay: noneを持つ（従業員未選択時、直接登録の詳細開閉ボタンが実際に表示されない）')
}

// ------------------------------------------------------------------
// CSS構造（指摘2対応）：固定件数（shiftEditSkillInlineLimit_）を前提にしていた仕組みを廃止し、
// 実幅計測用の.skill-tag-list--measuring・詳細側の折り返し用.skill-tag-list--detailへ
// 置き換わっていること
// ------------------------------------------------------------------
{
  var jsShift = fs.readFileSync(path.join(APP_DIR, 'js_shift.html'), 'utf8')
  assertTrue(jsShift.indexOf('shiftEditSkillInlineLimit_') === -1, 'js_shift.htmlにshiftEditSkillInlineLimit_（固定3件／1件の上限関数）が残っていない（指摘2対応）')
  assertTrue(jsShift.indexOf('function recalculateShiftEditSkillInlineVisibility_') !== -1, 'js_shift.htmlにrecalculateShiftEditSkillInlineVisibility_（実幅計測での再計算関数）が存在する')
  assertTrue(jsShift.indexOf('function startShiftEditSkillResizeWatch_') !== -1, 'js_shift.htmlにstartShiftEditSkillResizeWatch_（リサイズ監視の開始）が存在する')
  assertTrue(jsShift.indexOf('function stopShiftEditSkillResizeWatch_') !== -1, 'js_shift.htmlにstopShiftEditSkillResizeWatch_（リサイズ監視の停止）が存在する')
}
{
  var measuringRules = findRulesContainingSelector_(cssRules, '.skill-tag-list--measuring')
  var topLevelMeasuring = measuringRules.filter(function (r) { return !r.mediaCondition })
  assertTrue(topLevelMeasuring.length > 0, '.skill-tag-list--measuringのルールが存在する（実幅計測中に折り返しを止めて誤判定を防ぐ）')
  var hasNowrapMeasuring = topLevelMeasuring.some(function (r) { return /flex-wrap\s*:\s*nowrap/.test(r.declarationsText) })
  assertTrue(hasNowrapMeasuring, '.skill-tag-list--measuringはflex-wrap: nowrapを持つ')
}
{
  // レビュー対応（展開表示の重複解消 2026-09-16）：別行の「全マイスター」（旧.skill-tag-list--detail）を
  // 廃止し、常時表示のラベル列自体が展開時にoverflow: visible・flex-wrap: wrapへ切り替わる
  // .skill-tag-list--expandedへ置き換えた。長い名称も折り返して全文を読めるよう、
  // white-space: normalも引き継ぐ
  var expandedRules = cssRules.filter(function (r) { return r.selector === '.skill-tag-list--expanded' && !r.mediaCondition })
  assertTrue(expandedRules.length > 0, '.skill-tag-list--expandedのルールが存在する（展開時のラベル列自体の折り返しを許可する）')
  var hasOverflowVisible = expandedRules.some(function (r) { return /overflow\s*:\s*visible/.test(r.declarationsText) })
  assertTrue(hasOverflowVisible, '.skill-tag-list--expandedはoverflow: visibleを持つ（折りたたみ時のoverflow: hiddenを打ち消し、全件表示できるようにする）')
  var hasFlexWrapExpanded = expandedRules.some(function (r) { return /flex-wrap\s*:\s*wrap[^-]/.test(r.declarationsText + ' ') && !/nowrap/.test(r.declarationsText) })
  assertTrue(hasFlexWrapExpanded, '.skill-tag-list--expandedはflex-wrap: wrapを持つ（収まらない分は折り返す）')

  var expandedTagRules = cssRules.filter(function (r) { return r.selector === '.skill-tag-list--expanded .skill-tag' && !r.mediaCondition })
  assertTrue(expandedTagRules.length > 0, '.skill-tag-list--expanded .skill-tagのルールが存在する（展開時は長い名称も折り返して全文を読める）')
  var hasWhiteSpaceNormalExpanded = expandedTagRules.some(function (r) { return /white-space\s*:\s*normal/.test(r.declarationsText) })
  assertTrue(hasWhiteSpaceNormalExpanded, '.skill-tag-list--expanded .skill-tagはwhite-space: normalを持つ')
}
{
  // レビュー対応（展開表示の重複解消 2026-09-16、優先関係の修正 2026-09-21、従業員名の下へ
  // マイスターラベルを配置 2026-09-21）：ラベル列を折り返すには、親行
  // （.modal-field--skill-row、通常はflex-wrap: nowrap）自体も折り返しを許可する必要がある。
  // 展開中だけ付与する.modal-field--skill-row-expandedがそれを担うが、クラス単体セレクタだと
  // .modal-field--skill-rowのnowrapにソース順で上書きされるリスクがあるため、
  // .modal-field--skill-row.modal-field--skill-row-expanded（詳細度0,2,0）という結合セレクタで
  // 定義している（優先関係自体の検証は検証対象5で行う）
  var wrapExpandedRules = cssRules.filter(function (r) { return r.selector === '.modal-field--skill-row.modal-field--skill-row-expanded' && !r.mediaCondition })
  assertTrue(wrapExpandedRules.length > 0, '.modal-field--skill-row.modal-field--skill-row-expandedのルールが存在する（展開中は親行の折り返しも許可する。詳細度を.modal-field--skill-rowより上げるため結合セレクタにしている）')
  var hasFlexWrapOnParent = wrapExpandedRules.some(function (r) { return /flex-wrap\s*:\s*wrap[^-]/.test(r.declarationsText + ' ') && !/nowrap/.test(r.declarationsText) })
  assertTrue(hasFlexWrapOnParent, '.modal-field--skill-row.modal-field--skill-row-expandedはflex-wrap: wrapを持つ')
}
{
  // 旧仕組み（別行の詳細表示用クラス）が残っていないことの確認
  var oldDetailRules = cssRules.filter(function (r) { return r.selector === '.skill-tag-list--detail .skill-tag' })
  assertTrue(oldDetailRules.length === 0, '.skill-tag-list--detail .skill-tag（旧・別行詳細表示用のルール）はもう存在しない')
}

// ------------------------------------------------------------------
// レビュー対応（展開表示の幅計算、優先関係の修正 2026-09-21、従業員名の下へマイスターラベルを
// 配置 2026-09-21でクラス名を.modal-field--wrap→.modal-field--skill-rowへ改称）：
// .modal-field--skill-row-expanded（flex-wrap: wrap）は宣言としては存在していても、
// クラス単体セレクタ同士（詳細度0,1,0）である.modal-field--skill-rowのflex-wrap: nowrapと
// CSSソース順の勝敗に依存してしまうリスクがある。「宣言の有無」だけでなく「両クラス併記時に
// どちらが勝つか」を機械的に検証することで、定義順の入れ替えだけに頼らず、詳細度自体で
// 優先関係を担保できているかを確認する。
// ------------------------------------------------------------------
console.log('---')
console.log('検証対象5: 展開時の折り返しが.modal-field--skill-rowのnowrapに上書きされないこと（優先関係の検証）')
console.log('---')
{
  // 簡易カスケード判定：同じプロパティ（flex-wrap）を宣言するルールの中から、
  // 「.modal-field--skill-row.modal-field--skill-row-expanded」というクラス併記の要素に対して
  // 実際に適用されるルールを、詳細度→ソース順の優先順位で1つ選び出す
  function specificityOfSelector_(sel) {
    // クラスセレクタの数だけを数える簡易実装（このプロジェクトのCSSは要素・IDセレクタを
    // 混在させないシンプルな構成のため、クラス数の比較だけで十分に優先順位を判定できる）
    var classMatches = sel.match(/\.[a-zA-Z0-9_-]+/g)
    return classMatches ? classMatches.length : 0
  }
  function winningFlexWrapValue_(rules, targetClasses) {
    // targetClassesを全て持つ要素に「効き得る」ルール（セレクタの各パートが
    // targetClassesの部分集合であるもの）を抽出し、詳細度→ソース順（後勝ち）で決定する
    var candidates = rules.filter(function (r) {
      if (r.mediaCondition) return false
      if (!declares_(r.declarationsText, 'flex-wrap')) return false
      var parts = r.selector.split(',').map(function (s) { return s.trim() })
      return parts.some(function (sel) {
        var classesInSel = sel.match(/\.[a-zA-Z0-9_-]+/g) || []
        return classesInSel.every(function (c) { return targetClasses.indexOf(c) !== -1 })
      })
    })
    if (candidates.length === 0) return null
    var winner = candidates.reduce(function (best, r) {
      var spec = specificityOfSelector_(r.selector)
      if (!best || spec > best.spec || (spec === best.spec)) {
        // 詳細度が同じか上回る場合はソース順で後にあるものを優先（配列は元の出現順のまま）
        if (!best || spec >= best.spec) return { rule: r, spec: spec }
      }
      return best
    }, null)
    var m = winner.rule.declarationsText.match(/flex-wrap\s*:\s*([a-z-]+)/)
    return m ? m[1] : null
  }

  var winning = winningFlexWrapValue_(cssRules, ['.modal-field--skill-row', '.modal-field--skill-row-expanded'])
  assertTrue(winning === 'wrap', '.modal-field--skill-rowと.modal-field--skill-row-expandedが同時に付いた要素では、flex-wrap: wrap（展開時の折り返し）が最終的に勝つ')

  // 折りたたみ時（.modal-field--skill-rowのみ）は引き続きnowrapのままであること
  // （幅計測に必要なnowrapを、展開用ルールの詳細度変更で壊していないことの確認）
  var collapsedWinning = winningFlexWrapValue_(cssRules, ['.modal-field--skill-row'])
  assertTrue(collapsedWinning === 'nowrap', '.modal-field--skill-rowのみが付いた折りたたみ時は、引き続きflex-wrap: nowrapが勝つ（幅計測用のnowrapを壊していない）')
}

console.log('---')
console.log('検証対象3: 希望シフトモーダル（shift_wish_modal）の構造（従業員名の下段のマイスターラベル・本文スクロール化）')
console.log('---')

// ------------------------------------------------------------------
// HTML構造：shift_wish_modalにも.modal--form-scroll・.modal-body-scrollが適用されていること
// （shift_edit_modalと同じく<form>を持たない構成）
// ------------------------------------------------------------------
{
  var wishModalTagMatch = home.match(/<div id="shift_wish_modal"[^>]*>[\s\S]*?<div class="modal[^"]*"/)
  assertTrue(!!wishModalTagMatch && /class="modal modal--form-scroll"/.test(wishModalTagMatch[0]), 'shift_wish_modal内の.modalに.modal--form-scroll修飾クラスが重ねてある')
}
{
  // shift_wish_modal内の.modal-body-scrollが、従業員名・ラベル・希望時間・時刻入力・
  // エラーメッセージを含み、かつmodal-actions（登録・修正・削除・キャンセル）より前で
  // 終わっていること
  var wishModalStart = home.indexOf('id="shift_wish_modal"')
  var wishModalBodyScrollIdx = home.indexOf('class="modal-body-scroll"', wishModalStart)
  var wishEmployeeFieldIdx = home.indexOf('id="shift_wish_modal_employee"', wishModalStart)
  var wishMessageIdx = home.indexOf('id="shift_wish_modal_message"', wishModalStart)
  var wishActionsIdx = home.indexOf('class="modal-actions"', wishModalStart)
  assertTrue(wishModalBodyScrollIdx !== -1 && wishModalBodyScrollIdx < wishEmployeeFieldIdx, 'shift_wish_modalの.modal-body-scrollは従業員名フィールドより前から始まる（本文全体を囲む）')
  assertTrue(wishMessageIdx !== -1 && wishActionsIdx !== -1 && wishMessageIdx < wishActionsIdx, 'shift_wish_modal_message（エラーメッセージ）はmodal-actionsより前に出現する（操作領域が本文を覆わない）')
}

// ------------------------------------------------------------------
// HTML構造：マイスターラベル関連の要素がshift_edit_modalとは別IDで存在すること（混線防止の確認）
// レビュー対応（従業員名の下へマイスターラベルを配置 2026-09-21）：shift_edit_modalと同じく、
// 氏名は通常の.modal-field、マイスターラベルは氏名の下の別行（.modal-field--skill-row、
// id=shift_wish_modal_skill_wrapのまま据え置き）に分離した
// ------------------------------------------------------------------
assertTrue(/id="shift_wish_modal_skill_wrap"/.test(home), 'shift_wish_modal_skill_wrap（マイスターラベルの行、展開時にflex-wrap: wrapを付け外しする対象）が存在する')
assertTrue(/id="shift_wish_modal_skill_tags"/.test(home), 'shift_wish_modal_skill_tags（常時表示ラベル列。展開時はここへ隠れていた分を追加する）が存在する')
assertTrue(/id="shift_wish_skill_more_btn"/.test(home), 'shift_wish_skill_more_btn（「＋N件」／「折りたたむ」ボタン）が存在する')
assertTrue(home.indexOf('id="shift_wish_modal_skill_detail_field"') === -1, 'shift_wish_modal_skill_detail_field（旧・別行の全マイスター）はもう存在しない（展開表示の重複解消対応）')
assertTrue(home.indexOf('id="shift_wish_modal_skill_detail_tags"') === -1, 'shift_wish_modal_skill_detail_tags（旧・詳細行内の全マイスターラベル）はもう存在しない（展開表示の重複解消対応）')

{
  // 氏名の行は、ラベル列・ボタンを含まない通常の.modal-field
  var wishModalStart2 = home.indexOf('id="shift_wish_modal"')
  var wishNameFieldMatch = home.slice(wishModalStart2).match(/<p class="modal-field"><span class="modal-field__label">従業員<\/span><span id="shift_wish_modal_employee" class="modal-field__value"><\/span><\/p>/)
  assertTrue(!!wishNameFieldMatch, '希望シフトモーダルの氏名の行は通常の.modal-field（ラベル＋値のみ）で、ラベル列・「＋N件」ボタンを含まない')
}
{
  var wishSkillRowMatch = home.match(/<p class="modal-field modal-field--skill-row" id="shift_wish_modal_skill_wrap" hidden>[\s\S]*?<\/p>/)
  assertTrue(!!wishSkillRowMatch, '希望シフトモーダルのマイスターラベルの行（modal-field--skill-row、id=shift_wish_modal_skill_wrap）が存在し、HTML上の初期状態でhidden属性を持つ')
  if (wishSkillRowMatch) {
    var wishSkillRowHtml = wishSkillRowMatch[0]
    assertTrue(wishSkillRowHtml.indexOf('shift_wish_modal_skill_tags') !== -1, 'マイスターラベルの行にラベル列（shift_wish_modal_skill_tags）が含まれる（shift_edit_modal側のIDと異なる）')
    assertTrue(wishSkillRowHtml.indexOf('shift_wish_skill_more_btn') !== -1, 'マイスターラベルの行に「＋N件」ボタンが含まれる')
    assertTrue(wishSkillRowHtml.indexOf('shift_wish_modal_employee') === -1, 'マイスターラベルの行に氏名（shift_wish_modal_employee）は含まれない（氏名行とは別要素）')
  }
}
{
  var wishMoreBtnTagMatch = home.match(/<button type="button" id="shift_wish_skill_more_btn"[^>]*>/)
  assertTrue(!!wishMoreBtnTagMatch && /\bhidden\b/.test(wishMoreBtnTagMatch[0]), 'shift_wish_skill_more_btnはHTML上の初期状態でhidden属性を持つ（隠れているラベルがなければ出さない）')
  assertTrue(!!wishMoreBtnTagMatch && /type="button"/.test(wishMoreBtnTagMatch[0]), 'shift_wish_skill_more_btnはtype="button"（フォーム誤送信を起こさない）')
  // レビュー対応（展開表示の重複解消 2026-09-16）：aria-controlsは展開対象のラベル列自身
  // （shift_wish_modal_skill_tags）を指す。shift_edit_modal側の要素を誤って指さないことも
  // あわせて確認する
  assertTrue(!!wishMoreBtnTagMatch && /aria-controls="shift_wish_modal_skill_tags"/.test(wishMoreBtnTagMatch[0]), 'shift_wish_skill_more_btnのaria-controlsは展開対象のラベル列自身（shift_wish_modal_skill_tags）を指す（shift_edit_modal側の要素を誤って指さない）')
}

// 展開時にも勤務登録・希望修正・削除・キャンセルへ到達できる（HTML上の出現順で、ラベル列自体は
// modal-actionsより前にあり、別要素を新設せず同じ要素の中身が変わるだけなので、
// DOM構造自体は展開前後で変わらない）
{
  var wishInlineListIdx = home.indexOf('id="shift_wish_modal_skill_tags"')
  var wishActionsBtnIdx = home.indexOf('id="shift_wish_modal_register_btn"', home.indexOf('id="shift_wish_modal"'))
  assertTrue(wishInlineListIdx !== -1 && wishActionsBtnIdx !== -1 && wishInlineListIdx < wishActionsBtnIdx, 'ラベル列（shift_wish_modal_skill_tags）は勤務登録・希望修正・削除・キャンセルボタンより前のDOM順にある')
}

console.log('---')
console.log('検証対象4: 他モーダルへの影響がないこと（共通CSS変更による回帰がないこと）')
console.log('---')

// 判定詳細モーダル（.modal--judge-detail）・シフト変更削除モーダルの基本枠（.modal）が
// 引き続き存在し、.modal--form-scroll追加によって定義が消えていないことを確認する
{
  var judgeDetailRules = findRulesContainingSelector_(cssRules, '.modal--judge-detail')
  assertTrue(judgeDetailRules.length > 0, '既存の.modal--judge-detail（判定詳細モーダル）のルールは変更後も存在する')
  var baseModalRules = findRulesContainingSelector_(cssRules, '.modal')
  var topLevelBaseModal = baseModalRules.filter(function (r) { return !r.mediaCondition && r.selector === '.modal' })
  assertTrue(topLevelBaseModal.length > 0, '既存の.modal（基本枠）のルールは変更後も存在する')
  var hasMaxWidth24 = topLevelBaseModal.some(function (r) { return /max-width\s*:\s*24rem/.test(r.declarationsText) })
  assertTrue(hasMaxWidth24, '.modalの既存max-width: 24remは変更していない（.modal--form-scrollは別クラスとして重ねているだけ）')
}

// shift_wish_add_modal・shift_wish_modal等、他モーダルのhidden制御ルール（.modal-overlay）が
// 引き続き存在すること（display:none既定＋:not([hidden])でflexの対策を壊していないか）
{
  var overlayRules = cssRules.filter(function (r) { return r.selector === '.modal-overlay' && !r.mediaCondition })
  assertTrue(overlayRules.length > 0, '.modal-overlayの既定ルールが引き続き存在する')
  var overlayNotHiddenRules = cssRules.filter(function (r) { return r.selector === '.modal-overlay:not([hidden])' && !r.mediaCondition })
  assertTrue(overlayNotHiddenRules.length > 0, '.modal-overlay:not([hidden])のルールが引き続き存在する（hidden制御の対策を壊していない）')
}

console.log('---')
console.log('【ブラウザ確認が必要】このテストでは検証できない範囲:')
console.log('- 実際のブラウザでの見た目（モーダルの縦の長さ、変更・削除・登録・キャンセルボタンの見える位置）')
console.log('- 本文（.modal-body-scroll）だけが実際にスクロールし、操作領域が画面内に留まること（両モーダルとも）')
console.log('- 隠したラベル・「＋N件」ボタン・マイスター詳細開閉ボタンが、実際のブラウザで[hidden]優先ルール')
console.log('  どおりに非表示として描画され、Tab移動の対象からも外れること（[hidden]優先ルールの存在自体は')
console.log('  このテストで確認済みだが、実際の計算済みスタイル・フォーカス可能性の判定は未確認）')
console.log('- 下段のラベル列が実際のコンテナ幅・フォント・パディングで何件収まるか、実際のgetBoundingClientRect')
console.log('  の計算結果（recalculateShiftEditSkillInlineVisibility_のロジック自体の単体検証は')
console.log('  shift_modal_skill_display_test.jsで行うが、フェイクDOMは実レイアウトエンジンを再現しない）')
console.log('- 展開時に、実際のブラウザで.skill-tag-list--expanded（overflow: visible; flex-wrap: wrap）・')
console.log('  .modal-field--skill-row-expanded（flex-wrap: wrap）が意図通りに働き、ラベルが複数行に')
console.log('  折り返って全件読めること')
console.log('- 氏名がマイスターラベルの行と分離されたことで、狭い画面・長い氏名でも氏名側が')
console.log('  不自然に改行されず読みやすくなっていること')
console.log('- 小さい画面での実機表示・実際のウィンドウリサイズでラベル表示が追従すること')
console.log('- 展開中にウィンドウをリサイズしても、実際のブラウザで意図せず折りたたまれないこと')
console.log('- キーボード操作（Tab移動、Enter/Spaceでの開閉）の実際の挙動')
console.log('- 長い従業員名・長いマイスター名での実際のレイアウト崩れ、展開時の折り返し表示の見た目')
console.log('- 320px程度の狭い画面幅で、長い日本語氏名・空白のない長い英字氏名が実際に折り返り、')
console.log('  モーダル幅を超えてはみ出さないこと（overflow-wrap: anywhereの実際の描画結果）')
console.log('- マイスター情報がない従業員・別従業員への切替時に、ラベル行自体（[hidden]優先ルール）が')
console.log('  実際のブラウザで不要な空行を残さず消えること')
console.log('- shift_wish_modal（希望シフトモーダル）でも上記と同様に、ラベル表示・本文スクロール・')
console.log('  下部操作領域固定・[hidden]優先ルールが実際のブラウザで機能すること（HTML/CSS構造の')
console.log('  存在確認はこのテストで行ったが、実際の描画結果は未確認）')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
