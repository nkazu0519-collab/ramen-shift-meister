// 技能別の育成優先度（07_ブラッシュアップ/02_企画・設計/技能別育成優先度_最小仕様.md）:
// view_meister_bulk.htmlのクライアント側ロジックを、本番の<script>本文をVM・簡易DOMで直接実行して検証する。
// ロジックをこのファイルへ再実装しない（wish_status_client_test.jsと同じ方針）。
//
// view_meister_bulk.htmlのscriptはGASテンプレート構文（<?!= ... ?>）を2箇所含むため、
// vmへ渡す前にその2行だけをテスト用の値へ機械的に置き換える（本番ロジックの行は一切書き換えない）。
//
// 実行: node meister_skill_priority_client_test.js
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
function assertContains(haystack, needle, label) {
  var ok = String(haystack).indexOf(needle) >= 0
  var displayed = String(haystack).length > 120 ? String(haystack).slice(0, 120) + '...(略)' : haystack
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label + ' -> ' + JSON.stringify(displayed))
  if (ok) pass++; else fail++
}

function extractScriptBody_(html) {
  var m = html.match(/<script>([\s\S]*?)<\/script>/)
  if (!m) throw new Error('scriptタグが見つかりません')
  return m[1]
}

/**
 *  GASテンプレート構文（<?!= ... ?>）の行をテスト用の値へ置き換える。
 *  本番ロジックの行は変更しない。
 */
function stripGasTemplateSyntax_(scriptBody) {
  return scriptBody
    .replace(/var MEISTER_KEYS = <\?!= JSON\.stringify\(MEISTER_KEYS\) \?>;/, "var MEISTER_KEYS = ['手洗い伝道師', 'ホール', 'セット', '仕込み', '麺上げ'];")
    .replace(/var APP_URL = <\?!= JSON\.stringify\(getAppUrl\(\)\) \?>;/, "var APP_URL = 'https://example.com/exec';")
    .replace(/var WISH_PERIOD_FIRST_HALF = <\?!= JSON\.stringify\(WISH_PERIOD_FIRST_HALF_\) \?>;/, "var WISH_PERIOD_FIRST_HALF = 'first_half';")
    .replace(/var WISH_PERIOD_SECOND_HALF = <\?!= JSON\.stringify\(WISH_PERIOD_SECOND_HALF_\) \?>;/, "var WISH_PERIOD_SECOND_HALF = 'second_half';")
}

/**
 *  最小限のフェイクDOM要素（wish_status_client_test.jsのcreateFakeElement_と同じ最小主義の方針。
 *  view_meister_bulk.htmlが実際に使う範囲だけを再現する。details/summaryはネイティブAPIを使わず、
 *  hidden属性の付け外し相当のプロパティ操作だけで足りるため、tag名以外は他要素と同じ扱いでよい）
 */
function createFakeElement_(tag) {
  var classes = {}
  var attrs = {}
  var el = {
    tagName: tag,
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    disabled: false,
    className: '',
    dataset: {},
    children: [],
    classList: {
      add: function (c) { classes[c] = true; el._syncClassName() },
      remove: function (c) { delete classes[c]; el._syncClassName() },
      toggle: function (c, force) {
        var on = force === undefined ? !classes[c] : !!force
        if (on) classes[c] = true; else delete classes[c]
        el._syncClassName()
      },
      contains: function (c) { return !!classes[c] }
    },
    _syncClassName: function () {
      el.className = Object.keys(classes).filter(function (k) { return classes[k] }).join(' ')
    },
    setAttribute: function (name, value) { attrs[name] = String(value) },
    getAttribute: function (name) { return attrs.hasOwnProperty(name) ? attrs[name] : null },
    addEventListener: function () {},
    appendChild: function (child) {
      el.children.push(child)
      if (!el.firstChild) el.firstChild = child
      return child
    },
    removeChild: function (child) {
      var idx = el.children.indexOf(child)
      if (idx >= 0) el.children.splice(idx, 1)
      el.firstChild = el.children.length > 0 ? el.children[0] : null
    },
    firstChild: null
  }
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return el._innerHTML || '' },
    set: function (v) { el._innerHTML = v; if (v === '') { el.children = []; el.firstChild = null } }
  })
  return el
}

/**
 *  document.getElementById(id)が常に一貫した同一インスタンスを返すフェイクdocument。
 *  view_meister_bulk.htmlが参照するid一覧に対応する。未登録idのcreateElementも許可する。
 */
function createFakeDocument_() {
  var elements = {}
  var ids = [
    'meister_bulk_table_body', 'meister_bulk_status', 'meister_bulk_change_count', 'meister_bulk_save_btn',
    'meister_skill_priority', 'meister_skill_priority_list'
  ]
  ids.forEach(function (id) {
    elements[id] = createFakeElement_('div')
  })
  return {
    getElementById: function (id) {
      if (!elements[id]) throw new Error('未登録のid: ' + id)
      return elements[id]
    },
    createElement: function (tag) { return createFakeElement_(tag) },
    querySelectorAll: function () { return [] },
    addEventListener: function () {},
    _elements: elements
  }
}

/**
 *  google.script.runのフェイク（wish_status_client_test.jsのcreateFakeGoogleScriptRun_と同じ実装）。
 */
function createFakeGoogleScriptRun_(callLog) {
  function makeRunner() {
    var successHandler = null
    var failureHandler = null
    var proxy
    var runner = {
      withSuccessHandler: function (fn) { successHandler = fn; return proxy },
      withFailureHandler: function (fn) { failureHandler = fn; return proxy }
    }
    var handler = {
      get: function (target, prop) {
        if (prop in target) return target[prop]
        return function () {
          var args = Array.prototype.slice.call(arguments)
          var entry = { name: prop, args: args, resolve: null, reject: null }
          entry.resolve = function (result) { if (successHandler) successHandler(result) }
          entry.reject = function (error) { if (failureHandler) failureHandler(error) }
          callLog.push(entry)
          return proxy
        }
      }
    }
    proxy = new Proxy(runner, handler)
    return proxy
  }
  return { script: { get run() { return makeRunner() } } }
}

/**
 *  view_meister_bulk.htmlのscript本体を1つのVMコンテキストへ読み込む。
 *  document・google.script.run・windowはフェイクへ差し替える。
 */
function loadMeisterBulkClientEnv_() {
  var viewHtml = fs.readFileSync(path.join(APP_DIR, 'view_meister_bulk.html'), 'utf8')
  var scriptBody = stripGasTemplateSyntax_(extractScriptBody_(viewHtml))

  var fakeDocument = createFakeDocument_()
  var callLog = []
  var fakeGoogle = createFakeGoogleScriptRun_(callLog)
  var fakeWindow = { addEventListener: function () {}, confirm: function () { return true } }

  var sandbox = {
    console: console,
    document: fakeDocument,
    google: fakeGoogle,
    window: fakeWindow,
    Object: Object,
    JSON: JSON,
    Array: Array,
    String: String,
    Number: Number,
    encodeURIComponent: encodeURIComponent
  }
  vm.createContext(sandbox)
  vm.runInContext(scriptBody, sandbox, { filename: 'view_meister_bulk.html' })

  return { sandbox: sandbox, document: fakeDocument, callLog: callLog }
}

function makeRow_(empId, name, badges) {
  var full = { '手洗い伝道師': false, 'ホール': false, 'セット': false, '仕込み': false, '麺上げ': false }
  Object.keys(badges).forEach(function (k) { full[k] = badges[k] })
  return { employee_id: empId, employee_name: name, badges: full }
}

function sampleSkillPriority_() {
  // buildMeisterSkillPriority_の戻り値相当（サーバー集計の再実装はしない。クライアント側の描画確認用の固定データ）
  return [
    { key: '麺上げ', holder_count: 0, holder_names: [], status: 'none', status_label: '担当者なし' },
    { key: 'セット', holder_count: 1, holder_names: ['従業員B'], status: 'single', status_label: '一人依存・育成優先' },
    { key: 'ホール', holder_count: 3, holder_names: ['従業員A', '従業員B', '従業員C'], status: 'multiple', status_label: '保有者3人' },
    { key: '仕込み', holder_count: 2, holder_names: ['従業員A', '従業員C'], status: 'multiple', status_label: '保有者2人' }
  ]
}

console.log('検証対象: view_meister_bulk.html（技能別の育成優先度、クライアントロジック）')
console.log('---')

// ------------------------------------------------------------------
// 15/20. 正常取得時だけ4技能を描画し、技能名・人数・状態文言を表示する
// ------------------------------------------------------------------
{
  var env15 = loadMeisterBulkClientEnv_()
  var sb15 = env15.sandbox
  sb15.loadMeisterBulkView()
  var call15 = env15.callLog[env15.callLog.length - 1]
  assertEqual(call15.name, 'getMeisterBulkView', '15a. 初期化時にgetMeisterBulkViewを呼ぶ')

  var rows15 = [makeRow_('1', '従業員A', { 'ホール': true })]
  call15.resolve({ success: true, rows: rows15, skill_priority: sampleSkillPriority_() })

  var sectionEl15 = env15.document.getElementById('meister_skill_priority')
  assertTrue(!sectionEl15.hidden, '15b. 正常取得後は育成優先度カードを表示する')
  var listEl15 = env15.document.getElementById('meister_skill_priority_list')
  assertEqual(listEl15.children.length, 4, '15c. 4技能ぶんのカードを描画する')

  var texts15 = listEl15.children.map(function (card) {
    return card.children.map(function (c) { return c.textContent }).join('|')
  })
  var statusTexts15 = listEl15.children.map(function (card) { return card.children[1].textContent })
  assertTrue(texts15[0].indexOf('麺上げ') >= 0, '20a-前提. 麺上げカードに技能名を表示する')
  assertEqual(statusTexts15[0], '担当者なし（0人）', '20a. 麺上げカードの状態欄は「担当者なし（0人）」と完全一致し、「（0人）」が二重にならない')
  assertTrue(texts15[1].indexOf('セット') >= 0, '20b-前提. セットカードに技能名を表示する')
  assertEqual(statusTexts15[1], '一人依存・育成優先（1人）', '20b. セットカードの状態欄は「一人依存・育成優先（1人）」と完全一致し、「（1人）」が二重にならない')
  assertTrue(texts15[2].indexOf('ホール') >= 0, '20c-前提. ホールカードに技能名を表示する')
  assertEqual(statusTexts15[2], '保有者3人', '20c. ホールカードの状態欄は「保有者3人」と完全一致する（「保有者3人（3人）」にならない）')
  assertTrue(texts15[3].indexOf('仕込み') >= 0, '20d-前提. 仕込みカードに技能名を表示する')
  assertEqual(statusTexts15[3], '保有者2人', '20d. 仕込みカードの状態欄は「保有者2人」と完全一致する（「保有者2人（2人）」にならない）')
}

// ------------------------------------------------------------------
// 16. 読み込み中は育成優先度を表示しない（loadMeisterBulkView開始時に非表示・クリア）
// ------------------------------------------------------------------
{
  var env16 = loadMeisterBulkClientEnv_()
  var sb16 = env16.sandbox
  var sectionEl16 = env16.document.getElementById('meister_skill_priority')
  var listEl16 = env16.document.getElementById('meister_skill_priority_list')
  sectionEl16.hidden = false
  listEl16.children = [env16.document.createElement('div')]

  sb16.loadMeisterBulkView()

  assertTrue(sectionEl16.hidden, '16a. 読み込み開始時に育成優先度カードを非表示にする')
  assertEqual(listEl16.children.length, 0, '16b. 読み込み開始時に古い育成優先度の内容をクリアする')
}

// ------------------------------------------------------------------
// 17. success:falseのときは育成優先度を表示しない
// ------------------------------------------------------------------
{
  var env17 = loadMeisterBulkClientEnv_()
  var sb17 = env17.sandbox
  sb17.loadMeisterBulkView()
  var call17 = env17.callLog[env17.callLog.length - 1]
  call17.resolve({ success: false, message: '従業員一覧の取得に失敗しました' })

  assertTrue(env17.document.getElementById('meister_skill_priority').hidden, '17. success:falseのとき育成優先度カードは非表示のまま')
}

// ------------------------------------------------------------------
// 18. google.script.runの通信失敗でも育成優先度を表示しない
// ------------------------------------------------------------------
{
  var env18 = loadMeisterBulkClientEnv_()
  var sb18 = env18.sandbox
  sb18.loadMeisterBulkView()
  var call18 = env18.callLog[env18.callLog.length - 1]
  call18.reject({ message: 'ネットワークエラー' })

  assertTrue(env18.document.getElementById('meister_skill_priority').hidden, '18. 通信失敗時、育成優先度カードは非表示のまま')
}

// ------------------------------------------------------------------
// 19. 再読み込みで古い育成優先度を消し、最新結果へ置き換える
// ------------------------------------------------------------------
{
  var env19 = loadMeisterBulkClientEnv_()
  var sb19 = env19.sandbox
  sb19.loadMeisterBulkView()
  var call19a = env19.callLog[env19.callLog.length - 1]
  call19a.resolve({ success: true, rows: [makeRow_('1', '従業員A', { 'ホール': true })], skill_priority: sampleSkillPriority_() })

  var listEl19 = env19.document.getElementById('meister_skill_priority_list')
  assertEqual(listEl19.children.length, 4, '19-前提. 1回目の取得結果を描画している')

  // 2回目（再読み込み）。異なるskill_priorityへ置き換わることを確認する
  sb19.loadMeisterBulkView()
  assertEqual(listEl19.children.length, 0, '19a. 再読み込み開始時に一度クリアされる')
  var call19b = env19.callLog[env19.callLog.length - 1]
  var newPriority19 = [
    { key: 'ホール', holder_count: 0, holder_names: [], status: 'none', status_label: '担当者なし' },
    { key: 'セット', holder_count: 0, holder_names: [], status: 'none', status_label: '担当者なし' },
    { key: '仕込み', holder_count: 0, holder_names: [], status: 'none', status_label: '担当者なし' },
    { key: '麺上げ', holder_count: 0, holder_names: [], status: 'none', status_label: '担当者なし' }
  ]
  call19b.resolve({ success: true, rows: [], skill_priority: newPriority19 })
  assertEqual(listEl19.children.length, 4, '19b. 再読み込み後は最新結果（4技能とも0人）へ置き換わる')
  var texts19 = listEl19.children.map(function (c) { return c.children[0].textContent })
  assertEqual(texts19, ['ホール', 'セット', '仕込み', '麺上げ'], '19c. 再読み込み後の内容は最新レスポンスの技能順（古い結果の名残がない）')
}

// ------------------------------------------------------------------
// 21/22/23. 保有者詳細は表示しない（2026-09-23、氏名一覧の重複表示を廃止）。
// カードにはdetails/summary/詳細を見る/保有者名/「保有者はいません」のいずれも出さない
// ------------------------------------------------------------------
{
  var env21 = loadMeisterBulkClientEnv_()
  var sb21 = env21.sandbox
  sb21.loadMeisterBulkView()
  var call21 = env21.callLog[env21.callLog.length - 1]
  call21.resolve({ success: true, rows: [], skill_priority: sampleSkillPriority_() })

  var listEl21 = env21.document.getElementById('meister_skill_priority_list')
  var noneCard21 = listEl21.children[0] // 麺上げ（0人）
  // 0人・1人の技能には「育成候補を見る」ボタン（育成候補提示、2026-09-23）が追加されるため、
  // 技能名・状態文言・ボタンの3要素になる。detailsを持たないことが21aの本来の確認対象
  assertEqual(noneCard21.children.length, 3, '21a. 0人カードは技能名・状態文言・育成候補ボタンの3要素で構成される（details要素は持たない）')
  var hasDetails21 = listEl21.children.some(function (card) {
    return card.children.some(function (c) { return c.tagName === 'details' || c.tagName === 'summary' })
  })
  assertTrue(!hasDetails21, '21b. どのカードにもdetails/summary要素がない')

  var multiCard21 = listEl21.children[2] // ホール（3人）
  var allText21 = listEl21.children.map(function (card) {
    return card.children.map(function (c) { return c.textContent }).join('|')
  }).join('|')
  assertTrue(allText21.indexOf('詳細を見る') === -1, '21c. カード内に「詳細を見る」を表示しない')
  assertTrue(allText21.indexOf('保有者はいません') === -1, '23. カード内に「保有者はいません」を表示しない')
  assertTrue(allText21.indexOf('従業員A') === -1 && allText21.indexOf('従業員B') === -1 && allText21.indexOf('従業員C') === -1,
    '22. カード内に保有者名（個人名）を表示しない')
  assertEqual(multiCard21.children.length, 2, '21d. 保有者がいる技能（ホール）のカードも技能名・状態文言の2要素だけ')
}

// ------------------------------------------------------------------
// 24/25. buildSkillPriorityCard_はgoogle.script.run・保存・再読み込みを呼ばない。pendingChanges・チェック状態も変更しない
// ------------------------------------------------------------------
{
  var srcCheck24 = fs.readFileSync(path.join(APP_DIR, 'view_meister_bulk.html'), 'utf8')
  var buildCardMatch24 = srcCheck24.match(/function buildSkillPriorityCard_[\s\S]*?\n      \}/)
  assertTrue(!!buildCardMatch24, '24-前提. buildSkillPriorityCard_関数が存在する')
  var buildCardBody24 = buildCardMatch24[0]
  assertTrue(buildCardBody24.indexOf('google.script.run') === -1, '24a. buildSkillPriorityCard_はgoogle.script.runを呼ばない')
  assertTrue(buildCardBody24.indexOf('pendingChanges') === -1, '25a. buildSkillPriorityCard_はpendingChangesへ触れない')
  assertTrue(buildCardBody24.indexOf('.checked') === -1, '25b. buildSkillPriorityCard_はチェックボックスのchecked状態へ触れない')
  assertTrue(buildCardBody24.indexOf('loadMeisterBulkView') === -1, '24b. buildSkillPriorityCard_はloadMeisterBulkViewを再度呼ばない')
  assertTrue(buildCardBody24.indexOf('details') === -1, '24c. buildSkillPriorityCard_はdetails要素を作らない')
  assertTrue(buildCardBody24.indexOf('summary') === -1, '24d. buildSkillPriorityCard_はsummary要素を作らない')
  assertTrue(buildCardBody24.indexOf('holder_names') === -1, '24e. buildSkillPriorityCard_はholder_namesを参照しない')
}

// ------------------------------------------------------------------
// 26. 「保存済みの取得状況を集計。変更は保存後に反映」の案内がある
// ------------------------------------------------------------------
{
  var viewSrc26 = fs.readFileSync(path.join(APP_DIR, 'view_meister_bulk.html'), 'utf8')
  assertContains(viewSrc26, '保存済みの取得状況を集計しています', '26a. 「保存済みの取得状況を集計しています」の案内文がある')
  assertContains(viewSrc26, '変更は保存後に反映されます', '26b. 「変更は保存後に反映されます」の案内文がある')
  // 見出しが「技能別の育成優先度」であること、ページタイトルの下・編集表より前にあることも合わせて確認する
  assertContains(viewSrc26, '技能別の育成優先度', '26c. 見出しは「技能別の育成優先度」')
  var titleIdx26 = viewSrc26.indexOf('<h1 class="app-header__title">マイスター一括管理</h1>')
  var priorityIdx26 = viewSrc26.indexOf('id="meister_skill_priority"')
  var tableBodyTagIdx26 = viewSrc26.indexOf('<tbody id="meister_bulk_table_body">')
  assertTrue(titleIdx26 >= 0 && priorityIdx26 > titleIdx26 && priorityIdx26 < tableBodyTagIdx26,
    '26d. 育成優先度カードはページタイトルの下、従業員×マイスター編集表（<tbody>要素）より前に配置されている')
}

// ------------------------------------------------------------------
// 27. CSSでhiddenが正しく機能する（.card--feature自体はdisplayを指定せず、hidden属性の既定挙動に委ねている）
// ------------------------------------------------------------------
{
  var cssSrc27 = fs.readFileSync(path.join(APP_DIR, 'css.html'), 'utf8')
  var cardRuleMatch27 = cssSrc27.match(/\.card\s*\{[^}]*\}/)
  assertTrue(!!cardRuleMatch27, '27a. .cardのCSSルールが存在する')
  assertTrue(cardRuleMatch27[0].indexOf('display') === -1, '27b. .cardはdisplayを指定していない（[hidden]の既定display:noneと衝突しない）')
  assertTrue(/\.skill-priority-list\s*\{/.test(cssSrc27), '27c. 育成優先度専用のCSS（.skill-priority-listのルール）を追加している')
  assertTrue(!/\.skill-priority-card__details\s+summary\s*\{/.test(cssSrc27), '27d. 削除した詳細表示用CSS（.skill-priority-card__details summary）が残っていない')
  assertTrue(!/\.skill-priority-card__holders\s*\{/.test(cssSrc27), '27e. 削除した詳細表示用CSS（.skill-priority-card__holders）が残っていない')
}

// ------------------------------------------------------------------
// 28. 保存成功後の既存loadMeisterBulkView()再取得が維持されている（handleSaveClickの成功ハンドラ内）
// ------------------------------------------------------------------
{
  var env28 = loadMeisterBulkClientEnv_()
  var sb28 = env28.sandbox
  var handleSaveSrc28 = sb28.handleSaveClick.toString()
  assertTrue(handleSaveSrc28.indexOf('loadMeisterBulkView') >= 0, '28. handleSaveClickの成功時にloadMeisterBulkView()を再度呼ぶ既存処理が維持されている')
}

// ------------------------------------------------------------------
// 状態文言に「十分」「安全」「問題なし」「安定」を使わないことをクライアント描画結果でも確認する
// （サーバー側のstatus_labelをそのまま描画するだけであることの回帰確認）
// ------------------------------------------------------------------
{
  var env29 = loadMeisterBulkClientEnv_()
  var sb29 = env29.sandbox
  sb29.loadMeisterBulkView()
  var call29 = env29.callLog[env29.callLog.length - 1]
  call29.resolve({ success: true, rows: [], skill_priority: sampleSkillPriority_() })
  var listEl29 = env29.document.getElementById('meister_skill_priority_list')
  var allText29 = listEl29.children.map(function (card) {
    return card.children.map(function (c) { return c.textContent }).join('')
  }).join('')
  var forbidden29 = ['十分', '安全', '問題なし', '安定']
  forbidden29.forEach(function (w) {
    assertTrue(allText29.indexOf(w) === -1, '29. 育成優先度カードの表示文言に「' + w + '」を含まない')
  })
}

console.log('---')
console.log('【GAS実機確認が必要】このテストでは検証できない範囲:')
console.log('- 実際のブラウザでのCSSレイアウト・スマホ幅での見た目')
console.log('- details/summaryのキーボード操作・実際のクリック操作の感触')
console.log('- google.script.runの実際の通信タイミング・GAS側の実行時間')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
