// サイドバー開閉とモーダル表示の競合、および再レビューで見つかったフォーカス復帰の回帰
// （2026-09-16）を、本番のapp_sidebar.html・js_home_controller.html・js_shift.htmlに書かれた
// クライアントJSを直接Node.jsのvmで実行して検証する。ロジックをこのファイルへ再実装せず、
// 本番の<script>中身・close関数をそのまま読み込んで実行する。
//
// ブラウザのDOM・CustomEvent・MutationObserverは存在しないため、本番コードが実際に使う
// メソッド・プロパティ（getElementById/querySelector/classList/hidden/inert属性/
// addEventListener/matchMedia/MutationObserver/focus）だけを最小限のフェイクで再現する。
// フェイクはDOM操作のI/O層であり、サイドバー開閉・モーダル連携のロジックそのものではないため、
// ここで再現しても「本番ロジックの再実装をしない」という方針には反しない。
//
// 重要: フェイク要素のfocus()は、実ブラウザのinert仕様（inertな要素とその子孫はフォーカスを
// 受け取れない）を再現する。祖先をたどってinert属性を持つ要素があれば、focus()は無視され
// focusCallCountも増えない。これにより「MutationObserverの非同期解除より先にfocus()を呼ぶと
// 背景が.app-shellのinertが外れておらずフォーカスが失敗する」という回帰を再現できる。
//
// 実行: node sidebar_modal_interaction_test.js
// 失敗時は終了コード1で終わる。

'use strict'

var fs = require('fs')
var path = require('path')
var vm = require('vm')

var APP_DIR = path.join(__dirname, '..', '..', 'src')

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

/**
 *  <script>〜</script>の中身だけを取り出す（app_sidebar.html等は中身全体がこのタグ1組で
 *  囲まれたHTML断片。他のクライアントJSテストと同じ前提）
 */
function extractScriptBody_(html) {
  var m = html.match(/<script>([\s\S]*)<\/script>/)
  if (!m) throw new Error('scriptタグが見つかりません')
  return m[1]
}

/**
 *  最小限のフェイク要素。本番コードが使う範囲（classList.add/remove/toggle/contains、hidden、
 *  setAttribute/removeAttribute/getAttribute/hasAttribute＝inertとaria-expandedの読み書き、
 *  focus、querySelector（子孫の簡易検索）、value（input要素の入力値））を提供する。
 *  parentを持たせ、focus()時にinertな祖先がないかを実ブラウザと同じ考え方でチェックする
 */
function createFakeElement_(tag, id, classNames) {
  var classes = {}
  ;(classNames || []).forEach(function (c) { classes[c] = true })
  var attrs = {}
  var el = {
    tagName: tag,
    id: id || '',
    hidden: false,
    value: '',
    textContent: '',
    focusCallCount: 0,
    parent: null,
    children: [],
    style: {},
    classList: {
      add: function (c) { classes[c] = true },
      remove: function () { for (var i = 0; i < arguments.length; i++) delete classes[arguments[i]] },
      toggle: function (c, force) {
        var next = force === undefined ? !classes[c] : !!force
        if (next) classes[c] = true; else delete classes[c]
      },
      contains: function (c) { return !!classes[c] }
    },
    setAttribute: function (name, value) { attrs[name] = value },
    removeAttribute: function (name) { delete attrs[name] },
    getAttribute: function (name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null },
    hasAttribute: function (name) { return Object.prototype.hasOwnProperty.call(attrs, name) },
    /**
     *  実ブラウザのinert仕様を再現する：自分自身または祖先のいずれかがinert属性を持つ場合、
     *  focus()は無視される（フォーカスは移動せず、focusCallCountも増えない）。
     *  hidden要素も同様にフォーカスを受け取れない
     */
    focus: function () {
      var node = this
      while (node) {
        if (node.hasAttribute && node.hasAttribute('inert')) return
        if (node.hidden) return
        node = node.parent
      }
      this.focusCallCount++
    },
    appendChild: function (child) {
      child.parent = this
      this.children.push(child)
    },
    // setupAppSidebarTooltips_（本番のapp_sidebar.html）が呼ぶだけで、このテストでは
    // mouseenter/focusを実際に発火させないため、例外を出さない最小のno-opでよい
    addEventListener: function () {},
    getBoundingClientRect: function () { return { top: 0, right: 0, height: 0 } },
    querySelector: function (selector) {
      // このテストで使う範囲（'.app-sidebar__item'）だけに対応する簡易実装
      for (var i = 0; i < this.children.length; i++) {
        if (this.children[i]._matchesClass && this.children[i]._matchesClass(selector)) return this.children[i]
      }
      return null
    },
    _matchesClass: function (selector) {
      if (selector.charAt(0) !== '.') return false
      return !!classes[selector.slice(1)]
    }
  }
  return el
}

/**
 *  本番コードが参照するDOM構造を、view_home.html相当（モーダルあり）で組み立てる。
 *  withModals=falseにすると、view_detail.html・view_meister_bulk.html相当
 *  （モーダルのid自体が存在しない画面）を再現できる。
 *  shell配下にサイドバー・開閉ボタン・本文を実際に親子関係で繋ぎ、inertが子孫へ及ぶことを
 *  フェイク側でも再現できるようにする（focus()のinert祖先チェックが機能するために必要）
 */
function createFakeDocument_(withModals) {
  var elementsById = {}
  var shell = createFakeElement_('div', '', ['app-shell'])
  var toggleBtn = createFakeElement_('button', 'app_sidebar_toggle_btn')
  var toggleBtnIcon = createFakeElement_('span', '', ['app-sidebar-toggle-btn__icon'])
  toggleBtn.appendChild(toggleBtnIcon)
  var scrim = createFakeElement_('div', 'app_sidebar_scrim')
  scrim.hidden = true
  var sidebar = createFakeElement_('aside', 'app_sidebar')
  var navItem = createFakeElement_('a', '', ['app-sidebar__item'])
  var navItemTooltip = createFakeElement_('span', '', ['app-sidebar__tooltip'])
  navItem.appendChild(navItemTooltip)
  sidebar.appendChild(navItem)
  var pageContainer = createFakeElement_('div', '', ['page-container'])
  // 時間軸のシフトバー（モーダルを開いた起点要素）を模したボタン。.page-container配下に置く
  var shiftBarTriggerEl = createFakeElement_('button', 'shift_bar_trigger')
  pageContainer.appendChild(shiftBarTriggerEl)
  var body = createFakeElement_('body', '')

  shell.appendChild(toggleBtn)
  shell.appendChild(scrim)
  shell.appendChild(sidebar)
  shell.appendChild(pageContainer)
  body.appendChild(shell)

  elementsById['app_sidebar'] = sidebar
  elementsById['app_sidebar_toggle_btn'] = toggleBtn
  elementsById['app_sidebar_scrim'] = scrim
  elementsById['shift_bar_trigger'] = shiftBarTriggerEl

  var modalIds = ['shift_edit_modal', 'shift_direct_add_modal', 'shift_wish_add_modal', 'shift_wish_modal', 'judge_detail_modal']
  if (withModals) {
    modalIds.forEach(function (id) {
      // 本番と同様、モーダル自身は.app-shellの外側（body直下の兄弟）に置く
      var modal = createFakeElement_('div', id)
      modal.hidden = true // 初期状態は全モーダル非表示
      body.appendChild(modal)
      elementsById[id] = modal
    })
  }

  var keydownHandlers = []
  var mediaChangeHandlers = []

  var doc = {
    _elementsById: elementsById,
    _shell: shell,
    _pageContainer: pageContainer,
    _body: body,
    _keydownHandlers: keydownHandlers,
    getElementById: function (id) { return elementsById[id] || null },
    querySelector: function (selector) {
      if (selector === '.app-shell') return shell
      if (selector === '.page-container') return pageContainer
      return null
    },
    // setupAppSidebarTooltips_（本番のapp_sidebar.html）が使う範囲（'.app-sidebar__item'）だけに
    // 対応する簡易実装。サイドバー配下のnavItemを1件返す（本番は複数件だが、このテストでは
    // ツールチップのイベント登録が例外なく実行できることだけを確認できれば十分）
    querySelectorAll: function (selector) {
      if (selector === '.app-sidebar__item') return [navItem]
      return []
    },
    addEventListener: function (type, handler) {
      if (type === 'keydown') keydownHandlers.push(handler)
    },
    body: body
  }

  var mobileQuery = { matches: false, _changeHandlers: mediaChangeHandlers }
  mobileQuery.addEventListener = function (type, handler) {
    if (type === 'change') mediaChangeHandlers.push(handler)
  }

  var loadHandlers = []
  var resizeHandlers = []
  var win = {
    matchMedia: function () { return mobileQuery },
    addEventListener: function (type, handler) {
      if (type === 'load') loadHandlers.push(handler)
      // レビュー対応（実幅計測でのリサイズ監視 2026-09-16）：js_shift.htmlの
      // startShiftEditSkillResizeWatch_/stopShiftEditSkillResizeWatch_がwindow.resizeを
      // 使うため、このテストでも登録・解除を再現できるようにする（実際に発火はさせない）
      if (type === 'resize') resizeHandlers.push(handler)
    },
    removeEventListener: function (type, handler) {
      if (type === 'resize') {
        var idx = resizeHandlers.indexOf(handler)
        if (idx !== -1) resizeHandlers.splice(idx, 1)
      }
    }
  }

  var observedCallbacks = []
  function FakeMutationObserver(callback) {
    this.observe = function () { observedCallbacks.push(callback) }
  }

  return {
    document: doc,
    window: win,
    MutationObserver: FakeMutationObserver,
    _mobileQuery: mobileQuery,
    _loadHandlers: loadHandlers,
    _observedCallbacks: observedCallbacks,
    _shell: shell,
    _pageContainer: pageContainer,
    _body: body,
    _shiftBarTriggerEl: shiftBarTriggerEl,
    _sidebar: sidebar,
    _navItem: navItem,
    _navItemTooltip: navItemTooltip,
    _toggleBtn: toggleBtn,
    _toggleBtnIcon: toggleBtnIcon,
    // テスト用ヘルパー：window.load相当を発火させる（本番コードのwindow.addEventListener('load', resetAppSidebarForViewport_)を起動する）
    fireLoad: function () { loadHandlers.forEach(function (h) { h() }) },
    fireResize: function (matches) {
      mobileQuery.matches = matches
      mediaChangeHandlers.forEach(function (h) { h() })
    },
    fireKeydown: function (key) {
      var event = { key: key, _stopped: false, stopImmediatePropagation: function () { this._stopped = true } }
      for (var i = 0; i < keydownHandlers.length; i++) {
        if (event._stopped) break
        keydownHandlers[i](event)
      }
      return event
    },
    // モーダルのhidden切り替え後、本番のMutationObserverコールバックを模して同期関数を呼ぶ
    // （実ブラウザのMutationObserverは非同期だが、フェイクでは呼び出し側が明示的に発火させる。
    // 「非同期のまま」の挙動を再現したいテストでは、これをあえて呼ばずに済ませる）
    fireMutation: function () { observedCallbacks.forEach(function (cb) { cb() }) }
  }
}

/**
 *  app_sidebar.html（サイドバー開閉ロジック）、js_home_controller.html（モーダルのEscapeハンドラ）、
 *  必要ならjs_shift.htmlのcloseShiftEditModal_本体を同じvmコンテキストへ読み込む。
 *
 *  レビュー対応（Escapeハンドラの登録順 2026-09-16）: document.addEventListenerは登録順に
 *  呼ばれる。本番のview_home.htmlは<head>内でjs_home_controller.htmlを先にincludeし、
 *  <body>内でapp_sidebar.html（renderAppSidebar_の出力）を後から読み込むため、
 *  js_home_controller.html側のEscapeハンドラが必ず先に登録される。この順序を再現しないと、
 *  「モーダルを閉じた直後にサイドバー側のハンドラが古い状態を見て誤作動する」という
 *  stopImmediatePropagationの必要性そのものを検証できないため、ここでもこの順で読み込む
 */
function loadSidebarEnv_(withModals, withRealShiftEditModal) {
  var fake = createFakeDocument_(withModals)
  var sandbox = {
    console: console,
    document: fake.document,
    window: fake.window,
    MutationObserver: fake.MutationObserver
  }
  vm.createContext(sandbox)

  if (withRealShiftEditModal) {
    // closeShiftEditModal_本体（js_shift.html）が参照する変数・関数を、本番の依存を壊さない
    // 最小限で用意する。shiftEditRequestInProgress・shiftEditContext・shiftEditTriggerElは
    // js_shift.html内のトップレベル変数として宣言されるため、この段階では作らない
    // （スクリプト読み込み後にsandbox上で直接セットする）
    sandbox.clearShiftEditModalFields_ = function () {}
  } else if (withModals) {
    // 本体を読み込まない場合は、呼ばれたことだけ分かるフェイクにする
    // （このテストの検証対象外の3モーダル分。closeShiftEditModal_のフォーカス復帰の同期性検証は
    // 本番関数で行うため、ここでは他モーダルとの重複・競合の有無だけを見る）
    var closeCallCounts = { shift_edit_modal: 0, shift_wish_modal: 0, shift_direct_add_modal: 0, shift_wish_add_modal: 0, judge_detail_modal: 0 }
    sandbox.closeShiftEditModal_ = function () { closeCallCounts.shift_edit_modal++; fake.document.getElementById('shift_edit_modal').hidden = true }
    sandbox.closeShiftWishModal_ = function () { closeCallCounts.shift_wish_modal++; fake.document.getElementById('shift_wish_modal').hidden = true }
    sandbox.closeShiftDirectAddModal_ = function () { closeCallCounts.shift_direct_add_modal++; fake.document.getElementById('shift_direct_add_modal').hidden = true }
    sandbox.closeShiftWishAddModal_ = function () { closeCallCounts.shift_wish_add_modal++; fake.document.getElementById('shift_wish_add_modal').hidden = true }
    sandbox.closeJudgeDetailModal_ = function () { closeCallCounts.judge_detail_modal++; fake.document.getElementById('judge_detail_modal').hidden = true }
    fake._closeCallCounts = closeCallCounts
  }

  if (withModals) {
    var controllerFullScript = fs.readFileSync(path.join(APP_DIR, 'js_home_controller.html'), 'utf8')
    var controllerScript = extractScriptBody_(controllerFullScript)
    var escapeHandlerMatch = controllerScript.match(/document\.addEventListener\('keydown'[\s\S]*?\}\)/)
    if (!escapeHandlerMatch) throw new Error('js_home_controller.htmlのEscapeハンドラが見つかりません')
    // 本番と同じ順序（js_home_controller.htmlが先）でここで実行する
    vm.runInContext(escapeHandlerMatch[0], sandbox, { filename: 'js_home_controller.html (escape handler)' })
  }

  // app_sidebar.htmlは本番のview_home.htmlでは<body>内、js_home_controller.htmlより後に
  // 評価されるため、ここでも後から読み込む（Escapeハンドラの登録順を一致させるため）
  var sidebarScript = extractScriptBody_(fs.readFileSync(path.join(APP_DIR, 'app_sidebar.html'), 'utf8'))
  vm.runInContext(sidebarScript, sandbox, { filename: 'app_sidebar.html' })

  if (withRealShiftEditModal) {
    // js_shift.htmlのcloseShiftEditModal_本体・関連するトップレベル変数だけを抜き出して実行する
    // （closeShiftEditModal_はshiftEditRequestInProgress・shiftEditContext・shiftEditTriggerElという
    // js_shift.html内のトップレベル変数に依存するため、それらの宣言と関数本体を一緒に読み込む。
    // レビュー対応（希望シフトモーダルへのマイスターラベル追加 2026-09-16）：リサイズ監視の
    // ハンドラ参照はshiftEditSkillResizeHandler_というトップレベル変数ではなく、
    // createSkillTagUI_が返すui（shiftEditSkillTagUI_）のui.resizeHandlerへ移った。
    // stopShiftEditSkillResizeWatch_は共通ロジックstopSkillResizeWatch_(ui)の薄いラッパーに
    // なったため、createSkillTagUI_・stopSkillResizeWatch_・shiftEditSkillTagUI_の宣言も
    // 一緒に読み込む（未定義参照エラー防止）。
    // 他の関数はemployees・maisterSummaries等、このテストに無関係な状態へ依存するため対象外にする）
    var shiftFullScript = fs.readFileSync(path.join(APP_DIR, 'js_shift.html'), 'utf8')
    var shiftScript = extractScriptBody_(shiftFullScript)
    var varDeclMatch = shiftScript.match(/var shiftEditTriggerEl = null[^\n]*\n/)
    if (!varDeclMatch) throw new Error('js_shift.htmlのshiftEditTriggerEl宣言が見つかりません')
    var createUiFnMatch = shiftScript.match(/function createSkillTagUI_\(ids\) \{[\s\S]*?\n      \}/)
    if (!createUiFnMatch) throw new Error('js_shift.htmlのcreateSkillTagUI_が見つかりません')
    var stopCommonResizeWatchMatch = shiftScript.match(/function stopSkillResizeWatch_\(ui\) \{[\s\S]*?\n      \}/)
    if (!stopCommonResizeWatchMatch) throw new Error('js_shift.htmlのstopSkillResizeWatch_が見つかりません')
    var uiVarDeclMatch = shiftScript.match(/var shiftEditSkillTagUI_ = createSkillTagUI_\(\{[\s\S]*?\n      \}\)/)
    if (!uiVarDeclMatch) throw new Error('js_shift.htmlのshiftEditSkillTagUI_宣言が見つかりません')
    var stopResizeWatchMatch = shiftScript.match(/function stopShiftEditSkillResizeWatch_\(\) \{[\s\S]*?\n      \}/)
    if (!stopResizeWatchMatch) throw new Error('js_shift.htmlのstopShiftEditSkillResizeWatch_が見つかりません')
    var closeShiftEditModalMatch = shiftScript.match(/function closeShiftEditModal_\(\) \{[\s\S]*?\n      \}/)
    if (!closeShiftEditModalMatch) throw new Error('js_shift.htmlのcloseShiftEditModal_が見つかりません')
    if (typeof sandbox.window === 'undefined' || !sandbox.window) {
      throw new Error('sandboxにwindowが存在しません（stopShiftEditSkillResizeWatch_はwindow.removeEventListenerを使う）')
    }
    vm.runInContext(
      'var shiftEditRequestInProgress = false\nvar shiftEditContext = null\n' +
        varDeclMatch[0] + createUiFnMatch[0] + '\n' + stopCommonResizeWatchMatch[0] + '\n' +
        uiVarDeclMatch[0] + '\n' + stopResizeWatchMatch[0] + '\n' + closeShiftEditModalMatch[0],
      sandbox,
      { filename: 'js_shift.html (closeShiftEditModal_)' }
    )
  }

  fake.fireLoad()
  return { sandbox: sandbox, fake: fake }
}

console.log('検証対象: app_sidebar.html, js_home_controller.html, js_shift.html（本番のクライアントJSをフェイクDOMで実行）')
console.log('---')

// ------------------------------------------------------------------
// 1. モーダル表示中は.app-shellがinertになり、モーダルを閉じると解除される
// ------------------------------------------------------------------
{
  var env1 = loadSidebarEnv_(true)
  assertEqual(env1.fake._shell.hasAttribute('inert'), false, '1. 初期状態（モーダルなし）では.app-shellはinertではない')

  env1.fake.document.getElementById('shift_edit_modal').hidden = false
  env1.fake.fireMutation()
  assertEqual(env1.fake._shell.hasAttribute('inert'), true, '1. モーダルを開くと.app-shellがinertになる（サイドバー・ボタンへの操作を防ぐ）')

  env1.fake.document.getElementById('shift_edit_modal').hidden = true
  env1.fake.fireMutation()
  assertEqual(env1.fake._shell.hasAttribute('inert'), false, '1. モーダルを閉じるとinertが解除される')
}

// ------------------------------------------------------------------
// 2. モーダル表示中はtoggleAppSidebar_が何もしない（inertに加えて関数側でも二重に防ぐ）
// ------------------------------------------------------------------
{
  var env2 = loadSidebarEnv_(true)
  env2.fake.document.getElementById('judge_detail_modal').hidden = false
  env2.fake.fireMutation()

  var beforeAriaExpanded = env2.fake.document.getElementById('app_sidebar_toggle_btn').getAttribute('aria-expanded')
  env2.sandbox.toggleAppSidebar_()
  var afterAriaExpanded = env2.fake.document.getElementById('app_sidebar_toggle_btn').getAttribute('aria-expanded')
  assertEqual(afterAriaExpanded, beforeAriaExpanded, '2. モーダル表示中にtoggleAppSidebar_を呼んでも開閉状態が変化しない')
}

// ------------------------------------------------------------------
// 3. Escapeキー：モーダルが開いている場合はモーダル側のハンドラだけが処理し、
//    サイドバー側のcloseAppSidebar_は呼ばれない（stopImmediatePropagationで競合を防ぐ）。
//    登録順は本番と同じくjs_home_controller.html→app_sidebar.htmlにしている
// ------------------------------------------------------------------
{
  var env3 = loadSidebarEnv_(true)
  // スマホ幅でサイドバーを開いた状態を作る
  env3.fake.fireResize(true)
  env3.sandbox.toggleAppSidebar_()
  assertEqual(env3.fake._shell.classList.contains('is-sidebar-open'), true, '3. 前提：スマホでサイドバーが開いている')

  // ここでモーダルも開く（実際の画面では起こりにくいが、競合防止ロジック自体を確認するために意図的に作る）
  env3.fake.document.getElementById('shift_wish_modal').hidden = false
  env3.fake.fireMutation()

  env3.fake.fireKeydown('Escape')
  assertEqual(env3.fake._closeCallCounts.shift_wish_modal, 1, '3. Escapeでモーダル側のcloseShiftWishModal_が1回だけ呼ばれる')
  assertEqual(env3.fake._shell.classList.contains('is-sidebar-open'), true, '3. モーダルが優先されるため、サイドバーの開閉状態はEscape1回では変化しない（伝播停止が効いている）')
}

// ------------------------------------------------------------------
// 4. Escapeキー：モーダルが開いていない場合は、サイドバー側のcloseAppSidebar_が動く
// ------------------------------------------------------------------
{
  var env4 = loadSidebarEnv_(true)
  env4.fake.fireResize(true)
  env4.sandbox.toggleAppSidebar_()
  assertEqual(env4.fake._shell.classList.contains('is-sidebar-open'), true, '4. 前提：スマホでサイドバーが開いている（モーダルは閉じたまま）')

  env4.fake.fireKeydown('Escape')
  assertEqual(env4.fake._shell.classList.contains('is-sidebar-open'), false, '4. モーダルがなければEscapeでサイドバーが閉じる')
  assertEqual(env4.fake.document.getElementById('app_sidebar_toggle_btn').focusCallCount > 0, true, '4. 閉じたら開閉ボタンへフォーカスが戻る')
}

// ------------------------------------------------------------------
// 5. スマホでサイドバーを開くと本文（.page-container）がinertになり、閉じると解除される
// ------------------------------------------------------------------
{
  var env5 = loadSidebarEnv_(false)
  env5.fake.fireResize(true)
  assertEqual(env5.fake._pageContainer.hasAttribute('inert'), false, '5. 初期状態（閉）では本文はinertではない')

  env5.sandbox.toggleAppSidebar_()
  assertEqual(env5.fake._pageContainer.hasAttribute('inert'), true, '5. スマホでサイドバーを開くと本文がinertになる（Tabで本文へ出られない）')

  env5.sandbox.toggleAppSidebar_()
  assertEqual(env5.fake._pageContainer.hasAttribute('inert'), false, '5. サイドバーを閉じると本文のinertが解除される')
}

// ------------------------------------------------------------------
// 6. 画面幅変更（デスクトップ⇔スマホ）時に、開閉状態・inert・scrim・スクロールロックが
//    確実にリセットされる（レビュー対応：非表示要素へフォーカスを残さない、操作制限が残らない）
// ------------------------------------------------------------------
{
  var env6 = loadSidebarEnv_(false)
  env6.fake.fireResize(true)
  env6.sandbox.toggleAppSidebar_() // スマホで開く
  assertEqual(env6.fake._pageContainer.hasAttribute('inert'), true, '6. 前提：スマホでサイドバーが開き、本文がinert')
  assertEqual(env6.fake._body.classList.contains('app-sidebar-scroll-lock'), true, '6. 前提：背景スクロールロックが有効')

  // デスクトップ幅へ変更（境界をまたぐ）
  env6.fake.fireResize(false)
  assertEqual(env6.fake._pageContainer.hasAttribute('inert'), false, '6. 幅変更後、本文のinertが解除される')
  assertEqual(env6.fake._body.classList.contains('app-sidebar-scroll-lock'), false, '6. 幅変更後、背景スクロールロックが解除される')
  assertEqual(env6.fake._shell.classList.contains('is-sidebar-open'), false, '6. 幅変更後、スマホ用の開閉クラスが残らない')
  assertEqual(env6.fake.document.getElementById('app_sidebar').hidden, false, '6. デスクトップ幅ではサイドバーが表示される（初期状態＝展開）')
}

// ------------------------------------------------------------------
// 7. 閉じたメニュー内のリンクがhidden経由でTab移動対象から外れる
//    （hidden属性そのものの確認。ブラウザの実際のTab挙動はこのテストでは検証できない）
// ------------------------------------------------------------------
{
  var env7 = loadSidebarEnv_(false)
  env7.fake.fireResize(true) // スマホ、初期状態は閉じている
  assertEqual(env7.fake.document.getElementById('app_sidebar').hidden, true, '7. スマホの初期状態でサイドバーはhidden（内部リンクへTab移動できない）')

  env7.sandbox.toggleAppSidebar_()
  assertEqual(env7.fake.document.getElementById('app_sidebar').hidden, false, '7. 開くとhiddenが外れる')
}

// ------------------------------------------------------------------
// 8. サイドバー開閉・幅変更を繰り返しても、DOMに接続した入力要素の値（.page-container配下）は
//    変化しない（レビュー対応：独立変数の比較ではなく、実際に操作対象になり得る要素で検証する）
// ------------------------------------------------------------------
{
  var env8 = loadSidebarEnv_(false)
  var inputEl = createFakeElement_('input', 'fake_time_input')
  inputEl.value = '13:00'
  env8.fake._pageContainer.appendChild(inputEl)

  env8.fake.fireResize(true)
  env8.sandbox.toggleAppSidebar_()
  assertEqual(inputEl.value, '13:00', '8a. スマホでサイドバーを開いても、本文内の入力要素の値は変化しない')
  env8.sandbox.toggleAppSidebar_()
  assertEqual(inputEl.value, '13:00', '8b. サイドバーを閉じても値は変化しない')
  env8.fake.fireResize(false)
  assertEqual(inputEl.value, '13:00', '8c. 幅変更後も値は変化しない')
}

// ------------------------------------------------------------------
// 9. レビュー対応：フォーカス復帰の回帰（MutationObserverの非同期性に依存しない）
//    本番のcloseShiftEditModal_（js_shift.html）を実際に実行し、モーダルを開いた起点要素
//    （.app-shell外にあるシフトバー、実際はサイドバーと兄弟のtriggerElを模す）ではなく、
//    「.app-shell内にある要素」へのフォーカス復帰が、MutationObserverの発火を待たずに
//    成功することを確認する。あわせて「同期呼び出しを削除するとfocusが失敗する」ことも
//    比較用に確認し、この検証がinert状態を実際に意味のある形でチェックできていることを示す
// ------------------------------------------------------------------
{
  var env9 = loadSidebarEnv_(true, true)
  // モーダルを開いた状態を作る（.app-shellがinertになる）
  var editModal = env9.fake.document.getElementById('shift_edit_modal')
  editModal.hidden = false
  env9.fake.fireMutation() // モーダルを開いた直後のinert同期はここで確定させる
  assertEqual(env9.fake._shell.hasAttribute('inert'), true, '9. 前提：モーダル表示中は.app-shellがinert')

  // モーダルを開いた起点要素として、.app-shell内のサイドバーナビ項目を使う
  // （実際の時間軸バーは.page-container内にあるが、.app-shell配下という点は共通のため、
  // inertの影響を受ける代表として.app-shell直下の開閉ボタンを使う）
  var triggerEl = env9.fake.document.getElementById('app_sidebar_toggle_btn')
  env9.sandbox.shiftEditTriggerEl = triggerEl

  // 本番のcloseShiftEditModal_を実行する。MutationObserverのfireMutation()は呼ばない
  // （非同期のまま＝ブラウザで実際に起きる「コールバックがまだ実行されていない」状況を再現する）
  env9.sandbox.closeShiftEditModal_()

  assertEqual(editModal.hidden, true, '9. closeShiftEditModal_実行後、モーダルは閉じている')
  assertEqual(env9.fake._shell.hasAttribute('inert'), false, '9. MutationObserverの発火を待たずに、closeShiftEditModal_内の同期呼び出しでinertが解除されている')
  assertEqual(triggerEl.focusCallCount, 1, '9. inertが同期的に解除された結果、triggerElへのfocus()が成功する（フォーカス復帰の回帰が直っている）')
}

// ------------------------------------------------------------------
// 10. 比較用：syncAppShellInertForModal_の同期呼び出しがないとどうなるか（回帰の再現）。
//     app_sidebar.html側のsyncAppShellInertForModal_をあえて未定義にして、
//     MutationObserverの発火（fireMutation）を呼ばないままfocus()するとinertに阻まれて
//     フォーカスが失敗することを確認する。この対比によって、9番の検証が
//     「たまたま成功している」のではなく、同期呼び出しの有無で結果が変わることを示す
// ------------------------------------------------------------------
{
  var env10 = loadSidebarEnv_(true, true)
  var editModal10 = env10.fake.document.getElementById('shift_edit_modal')
  editModal10.hidden = false
  env10.fake.fireMutation()
  assertEqual(env10.fake._shell.hasAttribute('inert'), true, '10. 前提：モーダル表示中は.app-shellがinert')

  var triggerEl10 = env10.fake.document.getElementById('app_sidebar_toggle_btn')
  env10.sandbox.shiftEditTriggerEl = triggerEl10

  // syncAppShellInertForModal_を一時的に無効化し、「同期解除がなかったら」を再現する
  var originalSync = env10.sandbox.syncAppShellInertForModal_
  env10.sandbox.syncAppShellInertForModal_ = function () {}

  env10.sandbox.closeShiftEditModal_()
  assertEqual(editModal10.hidden, true, '10. モーダルは閉じている（比較対象なのでここは同じ）')
  assertEqual(env10.fake._shell.hasAttribute('inert'), true, '10. 同期解除を無効化すると、MutationObserverの発火（fireMutation）を呼ばない限りinertが残る')
  assertEqual(triggerEl10.focusCallCount, 0, '10. inertが残ったままだとfocus()は失敗する（focusCallCountが増えない）＝これが直す前の回帰の状態')

  env10.sandbox.syncAppShellInertForModal_ = originalSync
}

// ------------------------------------------------------------------
// 11. 他のモーダルがまだ開いている場合、必要な操作制限（inert）は維持される
//     （1つのモーダルを閉じても、別のモーダルが開いていればサイドバーへの操作を許可しない）
// ------------------------------------------------------------------
{
  var env11 = loadSidebarEnv_(true, true)
  env11.fake.document.getElementById('shift_edit_modal').hidden = false
  env11.fake.document.getElementById('judge_detail_modal').hidden = false
  env11.fake.fireMutation()
  assertEqual(env11.fake._shell.hasAttribute('inert'), true, '11. 前提：2つのモーダルが同時に開いている状態でinert')

  var triggerEl11 = env11.fake.document.getElementById('app_sidebar_toggle_btn')
  env11.sandbox.shiftEditTriggerEl = triggerEl11
  env11.sandbox.closeShiftEditModal_() // 1つだけ閉じる（judge_detail_modalはまだ開いたまま）

  assertEqual(env11.fake.document.getElementById('shift_edit_modal').hidden, true, '11. shift_edit_modalは閉じている')
  assertEqual(env11.fake.document.getElementById('judge_detail_modal').hidden, false, '11. judge_detail_modalはまだ開いている')
  assertEqual(env11.fake._shell.hasAttribute('inert'), true, '11. 別のモーダルがまだ開いているため、.app-shellのinertは維持される')
  assertEqual(triggerEl11.focusCallCount, 0, '11. inertが維持されているため、triggerElへのfocus()は成功しない（他モーダルが開いている間は背景操作を許可しない）')
}

// ------------------------------------------------------------------
// 12. レビュー対応（参考画像への合わせ込み 2026-09-16）：PC折りたたみは、以前の
//     「サイドバー全体をhiddenにする」方式から「サイドバー自体は表示したまま、アイコンだけの
//     細い列にする」方式へ変更した。折りたたんだ後もサイドバー本体・ナビ項目はhiddenにならず、
//     inertでもないため、クリック・Tab移動で引き続き操作できることを確認する
//     （PC幅では.app-shellにinertが付くのはモーダル表示中だけであり、折りたたみ自体はinertを使わない）
// ------------------------------------------------------------------
{
  var env12 = loadSidebarEnv_(false)
  // PC幅（デフォルトのmatches:falseのまま）でtoggleする
  assertEqual(env12.fake._shell.classList.contains('is-sidebar-collapsed'), false, '12. 前提：PC初期状態は展開（is-sidebar-collapsedなし）')
  assertEqual(env12.fake._sidebar.hidden, false, '12. 前提：展開時、サイドバー本体はhiddenではない')

  env12.sandbox.toggleAppSidebar_() // 折りたたむ
  assertEqual(env12.fake._shell.classList.contains('is-sidebar-collapsed'), true, '12. 折りたたむと.app-shellにis-sidebar-collapsedが付く')
  assertEqual(env12.fake._sidebar.hidden, false, '12. 折りたたんでもサイドバー本体はhiddenにならない（アイコン列として残る）')
  assertEqual(env12.fake._sidebar.hasAttribute('inert'), false, '12. 折りたたんでもサイドバー本体はinertにならない（アイコンが操作できる）')

  // 折りたたんだ状態でも、サイドバー内のナビ項目へfocus()が成功する（inert・hiddenのどちらにも阻まれない）
  env12.fake._navItem.focus()
  assertEqual(env12.fake._navItem.focusCallCount, 1, '12. 折りたたみ後もナビ項目（アイコン）へのfocus()が成功する＝Tab移動・クリックで操作できる')

  env12.sandbox.toggleAppSidebar_() // 展開に戻す
  assertEqual(env12.fake._shell.classList.contains('is-sidebar-collapsed'), false, '12. もう一度押すと展開に戻る')
}

// ------------------------------------------------------------------
// 13. 開閉ボタンのアイコン・aria-label・aria-expandedが、PC折りたたみの状態に応じて
//     正しく切り替わることを確認する（「メニュー」という固定文言は使わず、開閉の向きだけを示す）
// ------------------------------------------------------------------
{
  var env13 = loadSidebarEnv_(false)
  assertEqual(env13.fake._toggleBtn.getAttribute('aria-expanded'), 'true', '13. 前提：PC初期状態のaria-expandedはtrue')
  assertEqual(env13.fake._toggleBtn.getAttribute('aria-label'), 'サイドバーを折りたたむ', '13. 前提：展開時のaria-labelは「サイドバーを折りたたむ」')

  var expandedIcon = env13.fake._toggleBtnIcon.textContent

  env13.sandbox.toggleAppSidebar_() // 折りたたむ
  assertEqual(env13.fake._toggleBtn.getAttribute('aria-expanded'), 'false', '13. 折りたたむとaria-expandedがfalseになる')
  assertEqual(env13.fake._toggleBtn.getAttribute('aria-label'), 'サイドバーを展開する', '13. 折りたたむとaria-labelが「サイドバーを展開する」に変わる')
  var collapsedIcon = env13.fake._toggleBtnIcon.textContent
  assertTrue(collapsedIcon !== expandedIcon, '13. 折りたたむとアイコンの向きが展開時と異なる文字に変わる')

  env13.sandbox.toggleAppSidebar_() // 展開に戻す
  assertEqual(env13.fake._toggleBtn.getAttribute('aria-expanded'), 'true', '13. 展開に戻すとaria-expandedがtrueに戻る')
  assertEqual(env13.fake._toggleBtn.getAttribute('aria-label'), 'サイドバーを折りたたむ', '13. 展開に戻すとaria-labelも元に戻る')
  assertEqual(env13.fake._toggleBtnIcon.textContent, expandedIcon, '13. 展開に戻すとアイコンの向きも折りたたみ前と同じ文字に戻る')
}

// ------------------------------------------------------------------
// 14. PC折りたたみ時もモーダル表示中は引き続きinertで操作を防ぐ（12番の「折りたたみ単体では
//     inertにしない」と、モーダル競合対応（1番）の両立を確認する）
// ------------------------------------------------------------------
{
  var env14 = loadSidebarEnv_(true)
  env14.sandbox.toggleAppSidebar_() // 先に折りたたんでおく
  assertEqual(env14.fake._shell.classList.contains('is-sidebar-collapsed'), true, '14. 前提：折りたたみ済み')
  assertEqual(env14.fake._shell.hasAttribute('inert'), false, '14. 前提：折りたたんだだけではinertにならない')

  env14.fake.document.getElementById('shift_edit_modal').hidden = false
  env14.fake.fireMutation()
  assertEqual(env14.fake._shell.hasAttribute('inert'), true, '14. 折りたたみ状態でモーダルを開くと.app-shellがinertになる（アイコン列も操作不能になる）')

  env14.fake._navItem.focus()
  assertEqual(env14.fake._navItem.focusCallCount, 0, '14. モーダル表示中は、折りたたみ済みのアイコンへのfocus()も成功しない')
}

// ------------------------------------------------------------------
// 15. レビュー対応（ツールチップ 2026-09-16）：PC折りたたみ時、項目にhover/フォーカスすると
//     positionAppSidebarTooltip_がgetBoundingClientRect()の実座標からツールチップの位置を
//     計算し、style.left/topへ反映することを確認する。title属性だけに頼らず、キーボード
//     フォーカスでも項目名が見えるようにする対応の実効性を、本番関数を実行して検証する
// ------------------------------------------------------------------
{
  var env15 = loadSidebarEnv_(false)
  env15.fake._navItem.getBoundingClientRect = function () {
    return { top: 100, right: 60, height: 44 }
  }
  assertEqual(env15.fake._navItemTooltip.style.left, undefined, '15. 前提：位置計算前はツールチップのleftが未設定')

  env15.sandbox.positionAppSidebarTooltip_(env15.fake._navItem)
  assertEqual(env15.fake._navItemTooltip.style.left, '68px', '15. ツールチップのleftは項目の右端(right)+8pxに設定される')
  assertEqual(env15.fake._navItemTooltip.style.top, '122px', '15. ツールチップのtopは項目の垂直中央(top+height/2)に設定される')
}

console.log('---')
console.log('【ブラウザ・GAS実機確認が必要】このテストでは検証できない範囲:')
console.log('- 実際のブラウザでのz-index重なり順（モーダルが開閉ボタンより視覚的に手前に来ること）')
console.log('- inert属性の実際のTab移動・クリック無効化の挙動（フェイクDOMはfocus()拒否だけを再現しており、')
console.log('  ブラウザが実際にTab移動やクリックイベントそのものを止めるかどうかはここでは検証できない）')
console.log('- スマホ幅でサイドバーが開いている間、実際にTab／Shift+Tabがサイドバー内で循環し、本文へ出ないこと')
console.log('- モーダル表示中に実際のマウス操作でメニューボタン・背景リンクをクリックできないこと')
console.log('- キャンセル・Escapeでモーダルを閉じた際、実際のブラウザで見た目上もフォーカスリングが')
console.log('  正しい要素（元のシフトバー等）に表示されること')
console.log('- PCで本文を縦スクロールした際、実際にサイドバー本体と開閉ボタンが画面内に留まり続けること')
console.log('  （position:stickyの実描画・レイアウトはフェイクDOMでは再現できず、CSSの静的確認のみ）')
console.log('- ツールチップが実際に他要素と重ならず、サイドバーのoverflow-y:autoで見切れないこと')
console.log('- PC展開時・スマホで通常の項目名ラベルとツールチップ文字が重複表示されないこと、')
console.log('  PC展開→折りたたみ→再展開・スマホでの表示切り替えを実際のhover/フォーカス操作で確認すること')
console.log('  （:hover/:focus疑似クラスによる実際の表示はCSSレンダリングに依存するため、')
console.log('  静的なdisplay:none既定値の確認（sidebar_structure_test.js）に留めている）')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
