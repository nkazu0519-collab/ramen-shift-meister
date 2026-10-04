// freee_api.gsのgetEmployees()（全ページ取得・ページング）を、本番の.gsファイルをNode.jsのvmで
// 直接読み込んで検証する。ロジックをこのファイルへ再実装しない。
//
// UrlFetchApp.fetch（getEmployees内部はfetchAllではなく単発fetchをページごとに繰り返す実装）を
// フェイクへ差し替え、リクエストされたURL（limit・offset）に応じたレスポンスを返す。
//
// 実行: node freee_api_employees_test.js
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
 *  UrlFetchApp.fetchのフェイク。呼ばれるたびにcallLogへURLを記録し、handlerが返す
 *  { code, bodyText } または { throwOnFetch: true }（fetch自体が例外を投げる通信失敗を模す）を使う。
 *  handlerは (url) => response定義 の関数。offsetごとに異なるページを返すために使う
 */
function createFakeUrlFetchApp_(handler, callLog) {
  return {
    fetch: function (url, options) {
      callLog.push(url)
      var def = handler(url, options)
      if (def.throwOnFetch) throw new Error('通信エラー（テスト用、fetch自体が失敗）')
      return {
        getResponseCode: function () { return def.code },
        getContentText: function () { return def.bodyText }
      }
    }
  }
}

/**
 *  freee_api.gsだけを最小限のfetchAll不要な状態で読み込む（他の.gsファイルへの依存はないため、
 *  freee_api.gs単体をvmへ読み込めば足りる。company_id/accessTokenはgetRequestOptions・URL組み立てに
 *  必要なため、getRequestOptionsが実際に参照するグローバル変数として用意する）
 */
function loadFreeeApiEnv_(handler) {
  var callLog = []
  var sandbox = {
    console: console,
    companyId: 999,
    accessToken: 'fake-token'
  }
  vm.createContext(sandbox)
  sandbox.UrlFetchApp = createFakeUrlFetchApp_(handler, callLog)

  var source = fs.readFileSync(path.join(APP_DIR, 'freee_api.gs'), 'utf8')
  vm.runInContext(source, sandbox, { filename: 'freee_api.gs' })

  return { sandbox: sandbox, callLog: callLog }
}

function makeEmployeesPage_(startId, count) {
  var page = []
  for (var i = 0; i < count; i++) {
    page.push({ id: startId + i, display_name: '従業員' + (startId + i), entry_date: '2020-01-01', retire_date: null })
  }
  return page
}

console.log('検証対象: freee_api.gs（getEmployees、全ページ取得・ページング）')
console.log('---')

// ------------------------------------------------------------------
// 1. 100件＋次ページ（端数）を取得し、順番を維持して全件返す
// ------------------------------------------------------------------
{
  var page1_1 = makeEmployeesPage_(1, 100) // id:1〜100
  var page1_2 = makeEmployeesPage_(101, 30) // id:101〜130（端数、limit未満で終了）
  var env1 = loadFreeeApiEnv_(function (url) {
    if (url.indexOf('offset=0') >= 0) return { code: 200, bodyText: JSON.stringify(page1_1) }
    if (url.indexOf('offset=100') >= 0) return { code: 200, bodyText: JSON.stringify(page1_2) }
    return { code: 200, bodyText: JSON.stringify([]) } // 想定外offsetは空扱い（テスト側の安全弁）
  })
  var result1 = env1.sandbox.getEmployees()
  assertEqual(result1.length, 130, '1a. 100件＋30件の2ページで合計130件を返す')
  assertEqual(result1[0].id, 1, '1b. 先頭は1ページ目の最初の要素（id:1）')
  assertEqual(result1[99].id, 100, '1c. 100番目は1ページ目の最後の要素（id:100）')
  assertEqual(result1[100].id, 101, '1d. 101番目は2ページ目の最初の要素（id:101、ページ結合順を維持）')
  assertEqual(result1[129].id, 130, '1e. 最後は2ページ目の最後の要素（id:130）')
  assertEqual(env1.callLog.length, 2, '1f. 2回のリクエストで全件取得を終える')
  assertTrue(env1.callLog[0].indexOf('limit=100') >= 0, '1g. 1回目のリクエストにlimit=100を使う')
  assertTrue(env1.callLog[1].indexOf('offset=100') >= 0, '1h. 2回目のリクエストは実際に取得した件数（100）ぶんoffsetを進める')
}

// ------------------------------------------------------------------
// 2. ちょうど100件のとき次ページを確認し、空配列で終了する
// ------------------------------------------------------------------
{
  var page2_1 = makeEmployeesPage_(1, 100) // ちょうど100件
  var env2 = loadFreeeApiEnv_(function (url) {
    if (url.indexOf('offset=0') >= 0) return { code: 200, bodyText: JSON.stringify(page2_1) }
    if (url.indexOf('offset=100') >= 0) return { code: 200, bodyText: JSON.stringify([]) } // 次ページは空
    return { code: 200, bodyText: JSON.stringify([{ id: 9999, display_name: '想定外' }]) }
  })
  var result2 = env2.sandbox.getEmployees()
  assertEqual(result2.length, 100, '2a. ちょうど100件のとき、余計なページを混ぜず100件を返す')
  assertEqual(env2.callLog.length, 2, '2b. ちょうど100件でも次ページを1回確認し、空配列を受けて終了する（合計2リクエスト）')
  assertTrue(env2.callLog[1].indexOf('offset=100') >= 0, '2c. 2回目はoffset=100で次ページを確認する')
}

// ------------------------------------------------------------------
// 3. 1ページのみ（50件など、limit未満）で終了する
// ------------------------------------------------------------------
{
  var page3_1 = makeEmployeesPage_(1, 3)
  var env3 = loadFreeeApiEnv_(function () { return { code: 200, bodyText: JSON.stringify(page3_1) } })
  var result3 = env3.sandbox.getEmployees()
  assertEqual(result3.length, 3, '3a. 1ページ目がlimit未満（3件）なら1回のリクエストで終了する')
  assertEqual(env3.callLog.length, 1, '3b. 1回のリクエストしか行わない')
}

// ------------------------------------------------------------------
// 4. HTTP非200では成功扱いにせず、例外を投げる
// ------------------------------------------------------------------
{
  var env4 = loadFreeeApiEnv_(function () { return { code: 401, bodyText: JSON.stringify({ message: '権限がありません' }) } })
  var threw4 = false
  try {
    env4.sandbox.getEmployees()
  } catch (err) {
    threw4 = true
  }
  assertTrue(threw4, '4. HTTP非200（401）のとき例外を投げる（成功扱いにしない）')
}

// ------------------------------------------------------------------
// 5. 不正JSONでは成功扱いにせず、例外を投げる
// ------------------------------------------------------------------
{
  var env5 = loadFreeeApiEnv_(function () { return { code: 200, bodyText: '{不正なJSON' } })
  var threw5 = false
  try {
    env5.sandbox.getEmployees()
  } catch (err) {
    threw5 = true
  }
  assertTrue(threw5, '5. 不正JSONのとき例外を投げる（成功扱いにしない）')
}

// ------------------------------------------------------------------
// 6. レスポンスが配列でない（オブジェクト等）場合は成功扱いにせず、例外を投げる
// ------------------------------------------------------------------
{
  var env6 = loadFreeeApiEnv_(function () { return { code: 200, bodyText: JSON.stringify({ message: 'これは配列ではない' }) } })
  var threw6 = false
  try {
    env6.sandbox.getEmployees()
  } catch (err) {
    threw6 = true
  }
  assertTrue(threw6, '6. レスポンスが配列以外のとき例外を投げる（成功扱いにしない）')
}

// ------------------------------------------------------------------
// 7. 2ページ目以降で非200になった場合も、それまでの取得を成功扱いにせず例外を投げる
//    （部分的に取得できたページを不完全な結果として返さない）
// ------------------------------------------------------------------
{
  var page7_1 = makeEmployeesPage_(1, 100)
  var env7 = loadFreeeApiEnv_(function (url) {
    if (url.indexOf('offset=0') >= 0) return { code: 200, bodyText: JSON.stringify(page7_1) }
    return { code: 500, bodyText: JSON.stringify({ message: 'サーバーエラー' }) }
  })
  var threw7 = false
  try {
    env7.sandbox.getEmployees()
  } catch (err) {
    threw7 = true
  }
  assertTrue(threw7, '7. 2ページ目が非200のとき、1ページ目の取得結果があっても例外を投げる（不完全な結果を返さない）')
}

console.log('---')
console.log('【GAS実機確認が必要】このテストでは検証できない範囲:')
console.log('- 実際のfreee人事労務APIの実データ・実際のページ件数での動作')
console.log('- UrlFetchApp.fetchの実際の通信タイミング・GAS実行時間制限内で全ページ取得が収まるか')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
