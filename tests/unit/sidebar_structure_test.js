'use strict'

var fs = require('fs')
var path = require('path')

var APP_DIR = path.join(__dirname, '..', '..', 'src')
var sidebar = fs.readFileSync(path.join(APP_DIR, 'app_sidebar.html'), 'utf8')
var home = fs.readFileSync(path.join(APP_DIR, 'view_home.html'), 'utf8')
var meister = fs.readFileSync(path.join(APP_DIR, 'view_meister_bulk.html'), 'utf8')
var detail = fs.readFileSync(path.join(APP_DIR, 'view_detail.html'), 'utf8')
var web = fs.readFileSync(path.join(APP_DIR, 'web.gs'), 'utf8')
var css = fs.readFileSync(path.join(APP_DIR, 'css.html'), 'utf8')
var controller = fs.readFileSync(path.join(APP_DIR, 'js_home_controller.html'), 'utf8')
var jsShift = fs.readFileSync(path.join(APP_DIR, 'js_shift.html'), 'utf8')
var jsShiftWish = fs.readFileSync(path.join(APP_DIR, 'js_shift_wish.html'), 'utf8')
var jsJudge = fs.readFileSync(path.join(APP_DIR, 'js_judge.html'), 'utf8')

var pass = 0
var fail = 0
function assertTrue(value, label) {
  var ok = !!value
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label)
  if (ok) pass++; else fail++
}

assertTrue(/function renderAppSidebar_\(activePage\)/.test(web), '共通サイドバーの描画関数がある')
assertTrue(/createTemplateFromFile\(['"]app_sidebar['"]\)/.test(web), 'app_sidebarをテンプレートとして評価する')

var views = [
  { name: 'view_home', source: home },
  { name: 'view_meister_bulk', source: meister },
  { name: 'view_detail', source: detail }
]
views.forEach(function (view) {
  assertTrue(/renderAppSidebar_\(/.test(view.source), view.name + 'が共通サイドバーを描画する')
  assertTrue(/class="app-shell"/.test(view.source), view.name + 'が共通レイアウトを使う')
})

// サイドバーはページ遷移専用。ページ内アンカー（旧shift-register等）や
// section-anchorクラスはもう使わない
var removedSectionIds = ['shift-register', 'shift-check', 'break-check']
removedSectionIds.forEach(function (id) {
  assertTrue(home.indexOf('id="' + id + '"') === -1, 'ホームに#' + id + 'のページ内アンカーが存在しない')
  assertTrue(sidebar.indexOf('#' + id) === -1, 'サイドバーに#' + id + 'へのリンクが存在しない')
})
assertTrue(!/section-anchor/.test(home), 'ホームにsection-anchorクラスが存在しない')

// サイドバーのサブ項目（シフト登録／体制チェック／休憩候補）が存在しないこと
var removedSubLabels = ['シフト登録', '体制チェック', '休憩候補']
removedSubLabels.forEach(function (label) {
  assertTrue(sidebar.indexOf(label) === -1, 'サイドバーに「' + label + '」が存在しない')
})
assertTrue(!/app-sidebar__item--sub/.test(sidebar), 'サイドバーにサブ項目用クラスが存在しない')

assertTrue(/activePage === 'home'/.test(sidebar), 'ホームの選択状態を表示できる')
assertTrue(/activePage === 'meister'/.test(sidebar), 'マイスター管理の選択状態を表示できる')

// サイドバーには「シフト管理」「マイスター管理」という画面遷移項目（app-sidebar__item）が
// それぞれ1件だけあること。グループ見出し（app-sidebar__group-label）の「シフト管理」は
// ナビゲーション項目ではないため対象外にする
var navItemBlocks = sidebar.match(/<a class="app-sidebar__item[\s\S]*?<\/a>/g) || []
function countLabelInNavItems(label) {
  return navItemBlocks.filter(function (block) { return block.indexOf(label) !== -1 }).length
}
assertTrue(countLabelInNavItems('シフト管理') === 1, 'サイドバーの画面遷移項目に「シフト管理」が1件だけある')
assertTrue(countLabelInNavItems('マイスター管理') === 1, 'サイドバーの画面遷移項目に「マイスター管理」が1件だけある')

// シフト管理画面（view_home）からマイスター関連が完全に分離されていること
assertTrue(!/マイスター管理/.test(home), 'シフト管理画面に「マイスター管理」の見出し・カードが存在しない')
assertTrue(!/マイスター一括管理を開く/.test(home), 'シフト管理画面に「マイスター一括管理を開く」ボタンが存在しない')
assertTrue(!/\?empId=/.test(home), 'シフト管理画面に従業員別個別画面への一覧リンクが存在しない')

// マイスター管理画面（view_meister_bulk）から個別画面へ移動できること
assertTrue(/\?empId=/.test(meister), 'マイスター管理画面に従業員別個別画面へのリンクがある')

// サイドバー項目（app_sidebar__item）が重複していないこと（ブランドロゴのリンクは対象外）
var navSection = sidebar.slice(sidebar.indexOf('app-sidebar__nav'))
var navHrefs = navSection.match(/href="[^"]*"/g) || []
var uniqueNavHrefs = navHrefs.filter(function (href, index) {
  return navHrefs.indexOf(href) === index
})
assertTrue(navHrefs.length === uniqueNavHrefs.length, 'サイドバーのメニュー項目のリンク先が重複していない（' + JSON.stringify(navHrefs) + '）')

// マイスター一括・個人画面に「店主用画面に戻る」が存在しないこと（戻る操作はサイドバーの「シフト管理」に統一）
assertTrue(!/店主用画面に戻る/.test(meister), 'マイスター一括管理画面に「店主用画面に戻る」が存在しない')
assertTrue(!/店主用画面に戻る/.test(detail), '従業員個別画面に「店主用画面に戻る」が存在しない')

// ------------------------------------------------------------------
// サイドバーの開閉機能（レビュー対応: シフト作成・検討中の誤クリックによる入力消失懸念への対応）
// ------------------------------------------------------------------

// 開閉ボタンは常に表示され、aria-expanded・aria-controlsでサイドバーとの関係と開閉状態を伝える
assertTrue(/id="app_sidebar_toggle_btn"[^>]*aria-expanded="true"/.test(sidebar), '開閉ボタンの初期aria-expandedはtrue（PC初期状態＝展開）')
assertTrue(/id="app_sidebar_toggle_btn"[^>]*aria-controls="app_sidebar"/.test(sidebar), '開閉ボタンがaria-controlsでサイドバー本体と関連付けられている')
assertTrue(/id="app_sidebar_toggle_btn"[^>]*aria-label="[^"]+"/.test(sidebar), '開閉ボタンに状態を表すaria-labelがある')
assertTrue(/id="app_sidebar_toggle_btn"[^>]*onclick="toggleAppSidebar_\(\)"/.test(sidebar), '開閉ボタンがtoggleAppSidebar_を呼ぶ')

// レビュー対応（参考画像への合わせ込み 2026-09-16）：開閉ボタンに表示上の「メニュー」文字ラベルは
// 持たせず、アイコンのみにする。開閉ボタン要素自体のテキストノードを見て、アイコン用span以外に
// 可視テキストが残っていないことを確認する（aria-label・aria-hiddenのspan中身は別途確認済み）
var toggleBtnBlock = sidebar.match(/<button type="button" id="app_sidebar_toggle_btn"[\s\S]*?<\/button>/)
assertTrue(!!toggleBtnBlock, '開閉ボタンのHTMLブロックを取得できた')
if (toggleBtnBlock) {
  var toggleBtnInnerText = toggleBtnBlock[0]
    .replace(/<span class="app-sidebar-toggle-btn__icon"[^>]*>[\s\S]*?<\/span>/, '')
    .replace(/<[^>]+>/g, '')
    .trim()
  assertTrue(toggleBtnInnerText === '', '開閉ボタンに「メニュー」等の表示上のテキストラベルがない（アイコンのみ）')
}
assertTrue(!/>\s*メニュー\s*</.test(sidebar), 'サイドバー内に表示用の「メニュー」文言が存在しない')

// アイコンの向き（«/»）を状態に応じて切り替える仕組みがある
assertTrue(/APP_SIDEBAR_TOGGLE_ICON_EXPANDED_/.test(sidebar), '展開時アイコンの定数がある')
assertTrue(/APP_SIDEBAR_TOGGLE_ICON_COLLAPSED_/.test(sidebar), '折りたたみ時アイコンの定数がある')
assertTrue(/function updateAppSidebarToggleBtnState_\(/.test(sidebar), '開閉ボタンの見た目・aria属性をまとめて更新する関数がある')
assertTrue(/toggleBtn\.setAttribute\('aria-label', expanded \? '[^']+' : '[^']+'\)/.test(sidebar), 'aria-labelが展開・折りたたみの状態に応じて切り替わる')

// サイドバー本体はaria-controlsの参照先と一致するid、スマホの背景操作を防ぐscrim要素がある
assertTrue(/<aside class="app-sidebar" id="app_sidebar"/.test(sidebar), 'サイドバー本体のidがapp_sidebarである（aria-controlsの参照先と一致）')
assertTrue(/id="app_sidebar_scrim"[^>]*hidden/.test(sidebar), 'scrim要素は初期状態でhidden（背景操作を防ぐ要素は閉時は無効）')
assertTrue(/id="app_sidebar_scrim"[^>]*onclick="closeAppSidebar_\(\)"/.test(sidebar), 'scrimクリックで閉じる')

// 開閉JSの主要関数が揃っている（PC折りたたみ・スマホ開閉・Escape・幅変更時のリセットを分離して持つ）
var sidebarFunctionNames = ['toggleAppSidebar_', 'setAppSidebarCollapsed_', 'setAppSidebarOpenOnMobile_', 'closeAppSidebar_', 'resetAppSidebarForViewport_', 'isAppSidebarDesktop_']
sidebarFunctionNames.forEach(function (fnName) {
  assertTrue(new RegExp('function ' + fnName + '\\(').test(sidebar), 'app_sidebar.htmlに' + fnName + '関数がある')
})

// Escapeキーでサイドバーを閉じるハンドラがある
assertTrue(/event\.key !== 'Escape'/.test(sidebar), 'Escapeキーでサイドバーを閉じるハンドラがある')
assertTrue(/closeAppSidebar_\(\)/.test(sidebar), 'Escapeハンドラがclose処理を呼ぶ')

// レビュー対応（モーダルとの競合 2026-09-16）
// サイドバーのEscapeハンドラは、モーダルが開いている間は何もしない（js_home_controller.html側の
// モーダルEscapeハンドラに処理を譲る）。isAnyAppModalOpen_で判定する
assertTrue(/function isAnyAppModalOpen_\(/.test(sidebar), 'app_sidebar.htmlにisAnyAppModalOpen_関数がある')
assertTrue(/if \(isAnyAppModalOpen_\(\)\) return\s*\n\s*closeAppSidebar_\(\)/.test(sidebar), 'サイドバーのEscapeハンドラは、モーダルが開いていれば何もせずreturnする')
assertTrue(/function toggleAppSidebar_\(\) \{\s*\n\s*if \(isAnyAppModalOpen_\(\)\) return/.test(sidebar), 'toggleAppSidebar_はモーダル表示中は何もしない（inertに加えた二重の防御）')

// モーダル表示中は.app-shell全体（サイドバー・開閉ボタン・本文）をinertにする
assertTrue(/function syncAppShellInertForModal_\(/.test(sidebar), 'app_sidebar.htmlにsyncAppShellInertForModal_関数がある')
assertTrue(/shell\.setAttribute\('inert', ''\)/.test(sidebar), 'モーダル表示中は.app-shellへinert属性を付ける')
assertTrue(/shell\.removeAttribute\('inert'\)/.test(sidebar), 'モーダルを閉じると.app-shellのinertを解除する')
assertTrue(/new MutationObserver\(syncAppShellInertForModal_\)/.test(sidebar), 'モーダルのhidden切り替えをMutationObserverで監視し、inertを同期する')
assertTrue(/attributeFilter: \['hidden'\]/.test(sidebar), 'MutationObserverはhidden属性の変化だけを監視する')

// スマホでサイドバーが開いている間、本文（.page-container）もinertにしてTab移動・クリックを防ぐ
assertTrue(/pageContainer\.setAttribute\('inert', ''\)/.test(sidebar), 'スマホでサイドバーを開くと本文へinert属性を付ける')
assertTrue(/pageContainer\.removeAttribute\('inert'\)/.test(sidebar), 'サイドバーを閉じる・幅変更時に本文のinertを解除する')

// js_home_controller.html側：モーダルを閉じた場合はstopImmediatePropagationで後続ハンドラ（サイドバー側）を止める
var closeCallNames = ['closeShiftEditModal_', 'closeShiftWishModal_', 'closeShiftDirectAddModal_', 'closeJudgeDetailModal_']
closeCallNames.forEach(function (fnName) {
  var pattern = new RegExp(fnName + '\\(\\)\\s*\\n\\s*event\\.stopImmediatePropagation\\(\\)')
  assertTrue(pattern.test(controller), 'js_home_controller.htmlの' + fnName + '呼び出し直後にstopImmediatePropagationがある')
})

// 画面幅変更（デスクトップ⇔スマホの境界をまたぐ）を検知してリセットする仕組みがある
assertTrue(/matchMedia\('\(max-width: 48rem\)'\)/.test(sidebar), 'CSSと同じ48remの基準でメディアクエリを監視する')
assertTrue(/addEventListener\('change', resetAppSidebarForViewport_\)/.test(sidebar), '画面幅変更時にresetAppSidebarForViewport_を呼ぶ')
assertTrue(/addEventListener\('load', resetAppSidebarForViewport_\)/.test(sidebar), '読み込み時にもresetAppSidebarForViewport_を呼び、初期状態を揃える')

// レビュー対応（参考画像への合わせ込み 2026-09-16）：PC折りたたみは、以前の「サイドバー全体を
// hiddenにする」方式をやめ、サイドバー自体は表示し続けたままアイコンだけの細い列にする
// （参考画像のfreee人事労務サイドバーと同じ構成）。アイコンからの画面遷移・Tab移動を維持するため、
// setAppSidebarCollapsed_はsidebar.hiddenを操作せず、.app-shellへのクラス付け外しだけで幅・
// ラベル表示を切り替える（実際の幅切り替えはCSS側の.app-shell.is-sidebar-collapsed .app-sidebar-wrap）
assertTrue(/function setAppSidebarCollapsed_\(collapsed\) \{[\s\S]{0,200}\}/.test(sidebar), 'setAppSidebarCollapsed_関数がある')
var setCollapsedBlock = sidebar.match(/function setAppSidebarCollapsed_\(collapsed\) \{[\s\S]*?\n  \}/)
assertTrue(!!setCollapsedBlock, 'setAppSidebarCollapsed_の関数本体を取得できた')
if (setCollapsedBlock) {
  assertTrue(!/sidebar\.hidden/.test(setCollapsedBlock[0]), 'PC折りたたみはsidebar.hiddenを操作しない（サイドバー自体は表示し続ける）')
  assertTrue(/classList\.toggle\('is-sidebar-collapsed', collapsed\)/.test(setCollapsedBlock[0]), 'PC折りたたみは.app-shellへis-sidebar-collapsedクラスを付け外しするだけ')
}
// スマホ開閉は従来どおりサイドバー本体をhiddenで制御する（Tab移動から外す必要があるため）
assertTrue(/sidebar\.hidden = !open/.test(sidebar), 'スマホ開閉時はサイドバーのhidden属性を連動させる')

// フォーカス管理：開いたら先頭のメニュー項目へ、閉じたら開閉ボタンへ戻す
assertTrue(/firstLink\.focus\(\)/.test(sidebar), 'スマホでサイドバーを開いたら先頭のメニュー項目へフォーカスする')
assertTrue(/toggleBtn\.focus\(\)/.test(sidebar), 'サイドバーを閉じたら開閉ボタンへフォーカスを戻す')

// スマホでの背景スクロール抑止（既存の判定詳細モーダルと同じclassList.toggleパターン）
assertTrue(/classList\.toggle\('app-sidebar-scroll-lock', open\)/.test(sidebar), 'スマホでサイドバーを開いている間、背景スクロールを抑止するクラスを付ける')

// 開閉JSはページ遷移・再読み込み・フォーム送信を行わない（location操作や送信呼び出しがないことを確認する）
assertTrue(!/location\.(href|reload|assign|replace)/.test(sidebar), '開閉処理がページ遷移・再読み込みを行わない')
assertTrue(!/\.submit\(\)/.test(sidebar), '開閉処理がフォーム送信を行わない')

// CSS側：開閉ボタン・scrim・PC折りたたみ・スマホオーバーレイの各ルールが存在する
assertTrue(/\.app-sidebar-toggle-btn\s*\{/.test(css), '開閉ボタンのスタイルが存在する')
assertTrue(/\.app-sidebar-scrim\s*\{/.test(css), 'scrimのスタイルが存在する')
assertTrue(/\.app-sidebar-scrim:not\(\[hidden\]\)\s*\{[^}]*display:\s*block/.test(css), 'scrimはhidden属性が外れた時だけ表示される（[hidden]優先パターンを踏襲）')
assertTrue(/body\.app-sidebar-scroll-lock\s*\{[^}]*overflow:\s*hidden/.test(css), 'スマホでサイドバーが開いている間はbodyのスクロールを止めるルールがある')

// レビュー対応（参考画像への合わせ込み 2026-09-16）：PC折りたたみはdisplay:noneをやめ、
// 幅を細くしてアイコン列として残す方式にした
assertTrue(!/\.app-shell\.is-sidebar-collapsed \.app-sidebar\s*\{[^}]*display:\s*none/.test(css), 'PC折りたたみはサイドバーをdisplay:noneにしない（アイコン列として残す）')
assertTrue(/\.app-shell\.is-sidebar-collapsed \.app-sidebar-wrap\s*\{[^}]*--app-sidebar-width:\s*var\(--app-sidebar-collapsed-width\)/.test(css), 'PC折りたたみはサイドバー幅の変数を細い値に差し替えるだけ（本文の残り幅は自動的に広がる）')
assertTrue(/\.app-shell\.is-sidebar-collapsed \.app-sidebar__item-label\s*\{[\s\S]{0,10}display:\s*none/.test(css) || /\.app-shell\.is-sidebar-collapsed \.app-sidebar__brand-label,[\s\S]*?\.app-shell\.is-sidebar-collapsed \.app-sidebar__item-label\s*\{[^}]*display:\s*none/.test(css), 'PC折りたたみは項目名テキストだけを視覚的に隠す（アイコン自体・リンクは残る）')
assertTrue(/\.app-sidebar-toggle-btn\s*\{[^}]*position:\s*absolute/.test(css), '開閉ボタンはPC幅でposition:absolute配置（サイドバー右上、右端境界から張り出す）')
assertTrue(/\.app-sidebar-toggle-btn\s*\{[^}]*right:\s*-/.test(css), '開閉ボタンは右端境界から外側へ張り出す位置（負のrightオフセット）に置かれている')

// レビュー対応（スクロール追従 2026-09-16）：以前は外枠(.app-sidebar-wrap)がposition:relativeで
// 中の.app-sidebarだけがstickyだったため、絶対配置の開閉ボタンは外枠＝ページ全体の高さの中に
// 固定され、本文をスクロールすると画面外へ出てしまっていた。外枠自体をPC幅でstickyにし、
// サイドバー本体と境界の開閉ボタンを一緒に画面内へ留める
var wrapBlocks = css.match(/\.app-sidebar-wrap\s*\{[^}]*\}/g) || []
var wrapHasSticky = wrapBlocks.some(function (block) { return /position:\s*sticky/.test(block) })
var wrapHasTopZero = wrapBlocks.some(function (block) { return /top:\s*0/.test(block) })
assertTrue(wrapHasSticky, '.app-sidebar-wrapがPC幅でposition:stickyを持つ（外枠ごと画面内に追従する）')
assertTrue(wrapHasTopZero, '.app-sidebar-wrapがtop:0を持つ（スクロール追従の基準位置）')
assertTrue(!/\.app-sidebar-wrap\s*\{[^}]*position:\s*relative/.test(css), '.app-sidebar-wrapはもうposition:relativeではない（stickyに変更済み）')

// スマホ幅（48rem以下）では外枠を再びstatic/height:autoへ戻し、PC用のsticky・固定高さを
// 引きずらないようにする（スマホの固定配置・重ね表示を壊さないための回帰確認）
var mobileMediaBlockMatch = css.match(/@media \(max-width: 48rem\) \{[\s\S]*$/)
assertTrue(!!mobileMediaBlockMatch, '48rem以下のメディアクエリブロックを取得できた')
if (mobileMediaBlockMatch) {
  var mobileBlock = mobileMediaBlockMatch[0]
  assertTrue(/\.app-sidebar-wrap\s*\{[^}]*position:\s*static/.test(mobileBlock), 'スマホ幅では.app-sidebar-wrapをposition:staticへ戻す')
  assertTrue(/\.app-sidebar-wrap\s*\{[^}]*height:\s*auto/.test(mobileBlock), 'スマホ幅では.app-sidebar-wrapの固定高さ(100vh)を解除する')
}

// レビュー対応（ツールチップ 2026-09-16）：PC折りたたみ時、title属性だけではキーボードフォーカス時に
// ブラウザがツールチップを表示しないため、hover・フォーカスの両方で項目名を確認できる
// CSSツールチップ（.app-sidebar__tooltip）を用意する。position:fixedにしてサイドバーの
// overflow-y:autoで表示が切れないようにする
assertTrue(/<span class="app-sidebar__tooltip"/.test(sidebar), '各ナビ項目にツールチップ用のspan（app-sidebar__tooltip）がある')

// レビュー対応（表示重複の修正 2026-09-16）：既定の非表示（display:none）は.app-shell.is-sidebar-collapsed
// に限定せず、.app-sidebar__tooltip単体のルールとして持たせる。表示条件（display:block）だけを
// PC折りたたみ中のhover・フォーカスに限定することで、PC展開時・スマホでは常にdisplay:noneのままになり、
// 通常の項目名ラベルとの重複表示を防ぐ
var tooltipBaseBlockMatch = css.match(/\.app-sidebar__tooltip\s*\{[^}]*\}/)
assertTrue(!!tooltipBaseBlockMatch, '.app-sidebar__tooltip単体（状態を限定しないセレクタ）のスタイルブロックを取得できた')
if (tooltipBaseBlockMatch) {
  assertTrue(/display:\s*none/.test(tooltipBaseBlockMatch[0]), '.app-sidebar__tooltipは状態に関係なく既定でdisplay:noneを持つ（PC展開時・スマホでも重複表示しない）')
  assertTrue(/position:\s*fixed/.test(tooltipBaseBlockMatch[0]), 'ツールチップはposition:fixedで配置され、サイドバーのoverflowに切り取られない')
}
assertTrue(!/^\s*\.app-shell\.is-sidebar-collapsed \.app-sidebar__tooltip\s*\{/m.test(css), '.app-shell.is-sidebar-collapsedに限定した.app-sidebar__tooltip単体の非表示ルールはもう存在しない（既定ルールへ統合済み）')
assertTrue(/\.app-shell\.is-sidebar-collapsed \.app-sidebar__item:hover \.app-sidebar__tooltip/.test(css), 'ツールチップの表示条件（hover）はPC折りたたみ中に限定される')
assertTrue(/\.app-shell\.is-sidebar-collapsed \.app-sidebar__item:focus(-visible)? \.app-sidebar__tooltip/.test(css), 'ツールチップの表示条件（キーボードフォーカス）もPC折りたたみ中に限定される')
assertTrue(/function positionAppSidebarTooltip_\(/.test(sidebar), 'ツールチップの表示位置を計算する関数がある')
assertTrue(/function setupAppSidebarTooltips_\(/.test(sidebar), 'ツールチップのhover・focusリスナーを設定する関数がある')
assertTrue(/setupAppSidebarTooltips_\(\)/.test(sidebar), 'setupAppSidebarTooltips_が呼び出される')

assertTrue(/\.app-shell\.is-sidebar-open \.app-sidebar\s*\{/.test(css), 'スマホでサイドバーを開いた時のオーバーレイ表示ルールがある（48rem以下のメディアクエリ内）')
assertTrue(/position:\s*fixed;[\s\S]{0,80}z-index:\s*10;[\s\S]{0,120}width:\s*16rem/.test(css), 'スマホの開いたサイドバーはfixed配置で本文に重ねて表示する（本文を押し縮めない）')
assertTrue(/@media \(max-width: 48rem\) \{[\s\S]*?\.app-sidebar-toggle-btn\s*\{[^}]*position:\s*fixed/.test(css), 'スマホ幅では開閉ボタンがposition:fixedになり、サイドバーが閉じていても独立して表示され続ける')

// レビュー対応（重なり順の修正 2026-09-16）：モーダルは開閉ボタン（z-index:11）・サイドバー本体
// （z-index:9〜10）より必ず手前に来るよう、明確に大きいz-indexを持つ
function extractZIndex_(source, selectorPattern) {
  var re = new RegExp(selectorPattern + '\\s*\\{[^}]*z-index:\\s*(\\d+)')
  var m = source.match(re)
  return m ? Number(m[1]) : null
}
var toggleBtnZIndex = extractZIndex_(css, '\\.app-sidebar-toggle-btn')
var scrimZIndex = extractZIndex_(css, '\\.app-sidebar-scrim')
var modalOverlayZIndex = extractZIndex_(css, '\\.modal-overlay')
assertTrue(toggleBtnZIndex !== null && scrimZIndex !== null && modalOverlayZIndex !== null, '開閉ボタン・scrim・モーダルのz-indexをいずれも取得できた（' + JSON.stringify({ toggleBtnZIndex: toggleBtnZIndex, scrimZIndex: scrimZIndex, modalOverlayZIndex: modalOverlayZIndex }) + '）')
assertTrue(modalOverlayZIndex > toggleBtnZIndex, 'モーダルのz-indexは開閉ボタンより大きい（モーダルが視覚的に手前に来る）')
assertTrue(modalOverlayZIndex > scrimZIndex, 'モーダルのz-indexはscrimより大きい')

// ------------------------------------------------------------------
// レビュー対応（フォーカス復帰の回帰 2026-09-16）：MutationObserverによる非同期のinert解除を
// 待たずに、各モーダルのclose関数がhidden設定の直後・focus()の直前でsyncAppShellInertForModal_を
// 同期的に呼んでいることを静的に確認する。呼び出し順序（hidden設定→同期解除→focus）の
// 実際の効果は、状態遷移を追うsidebar_modal_interaction_test.js側（本番のclose関数を実行する
// テスト9〜11）で検証している。ここではその前提となる「呼んでいる」という静的事実だけを見る
// ------------------------------------------------------------------
// レビュー対応（実幅計測でのリサイズ監視 2026-09-16）でhidden設定とsyncAppShellInertForModal_の
// 間にstopShiftEditSkillResizeWatch_の呼び出しとその説明コメントが増えたため、上限を200→450へ広げた
// （呼び出し順序自体の検証という意図は変えていない）
assertTrue(/document\.getElementById\('shift_edit_modal'\)\.hidden = true[\s\S]{0,450}syncAppShellInertForModal_\(\)[\s\S]{0,150}shiftEditTriggerEl\.focus\(\)/.test(jsShift), 'closeShiftEditModal_はhidden設定→syncAppShellInertForModal_→focusの順で呼ぶ')
// レビュー対応（希望シフトモーダルへのマイスターラベル追加 2026-09-16）でhidden設定と
// syncAppShellInertForModal_の間にstopSkillResizeWatch_・clearSkillTags_の呼び出しとその
// 説明コメントが増えたため、上限を200→450へ広げた（呼び出し順序自体の検証という意図は変えていない）
assertTrue(/document\.getElementById\('shift_wish_modal'\)\.hidden = true[\s\S]{0,450}syncAppShellInertForModal_\(\)[\s\S]{0,150}shiftWishTriggerEl\.focus\(\)/.test(jsShiftWish), 'closeShiftWishModal_はhidden設定→syncAppShellInertForModal_→focusの順で呼ぶ')
assertTrue(/modal\.hidden = true[\s\S]{0,200}syncAppShellInertForModal_\(\)[\s\S]{0,150}judgeDetailModalTriggerEl\.focus\(\)/.test(jsJudge), 'closeJudgeDetailModal_はhidden設定→syncAppShellInertForModal_→focusの順で呼ぶ')

// setTimeoutの実際の呼び出しに頼っていないことの確認（コメント中の説明文は対象外にし、
// 実際の関数呼び出し構文 setTimeout( だけを見る。任意時間の遅延ではなく同期処理で解決する方針の確認）
assertTrue(!/setTimeout\s*\(/.test(jsShift), 'js_shift.htmlはsetTimeout()呼び出しでフォーカス復帰を遅延させていない')
assertTrue(!/setTimeout\s*\(/.test(jsShiftWish), 'js_shift_wish.htmlはsetTimeout()呼び出しでフォーカス復帰を遅延させていない')
assertTrue(!/setTimeout\s*\(/.test(jsJudge), 'js_judge.htmlはsetTimeout()呼び出しでフォーカス復帰を遅延させていない')

// ------------------------------------------------------------------
// レビュー対応（参考画像への合わせ込み 2026-09-16）：PC折りたたみでアイコンのみになった項目にも
// アクセシブルな名前を残す。title属性（hover時のブラウザ標準ツールチップ）とaria-label
// （スクリーンリーダー・一部ブラウザのフォーカス時ヒント）の両方を持たせていることを確認する
// ------------------------------------------------------------------
var navItemBlocksForA11y = sidebar.match(/<a class="app-sidebar__item[\s\S]*?<\/a>/g) || []
// 従業員希望シフト一括提出（2026-09-21）で「希望シフト提出」を追加したため、2件→3件になった
// （シフト管理・マイスター管理・希望シフト提出）。さらに希望シフト提出状況（2026-09-22）で
// 「提出状況」を追加したため、3件→4件になった（シフト管理・提出状況・マイスター管理・希望シフト提出）
assertTrue(navItemBlocksForA11y.length === 4, 'サイドバーのナビ項目が4件取得できた（シフト管理・提出状況・マイスター管理・希望シフト提出）')
navItemBlocksForA11y.forEach(function (block, idx) {
  assertTrue(/title="[^"]+"/.test(block), 'ナビ項目' + idx + 'にtitle属性がある（hover時に項目名を確認できる）')
  assertTrue(/aria-label="[^"]+"/.test(block), 'ナビ項目' + idx + 'にaria-label属性がある（フォーカス時・スクリーンリーダーで項目名を確認できる）')
})
// GASテンプレート構文（<?= getAppUrl() ?>）内の"?>"に">"が含まれるため、[^>]*で属性を
// またごうとすると途中で止まってしまう。ここではclass="app-sidebar__brand"の開始位置から
// 250文字以内という緩い範囲でaria-labelの有無を確認する
var brandBlockStart = sidebar.indexOf('class="app-sidebar__brand"')
assertTrue(brandBlockStart !== -1, 'ブランドロゴのリンク（class="app-sidebar__brand"）が見つかった')
if (brandBlockStart !== -1) {
  var brandBlockNear = sidebar.slice(brandBlockStart, brandBlockStart + 150)
  assertTrue(/aria-label="[^"]+"/.test(brandBlockNear), 'ブランドロゴのリンクにもaria-labelがある（折りたたみ時にブランド名テキストが隠れても名前が分かる）')
}

// 折りたたみ時に項目名テキストを隠すクラス（app-sidebar__item-label等）が、リンク要素自体にではなく
// 内部のspanだけに付いていることを確認する（リンク自体をdisplay:noneにするとクリック領域ごと
// 消えてしまうため、aria-label付きのリンクは常に残し、可視テキストのspanだけを隠す設計になっている）
assertTrue(/<span class="app-sidebar__item-label">/.test(sidebar), '項目名テキストは専用のspan（app-sidebar__item-label）に入っている')
assertTrue(/<span class="app-sidebar__brand-label">/.test(sidebar), 'ブランド名テキストは専用のspan（app-sidebar__brand-label）に入っている')

console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
