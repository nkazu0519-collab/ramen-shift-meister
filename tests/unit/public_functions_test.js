// ファイル分割で、末尾が「_」ではない既存の公開名関数（google.script.runやテンプレート式から
// 呼ばれる想定の関数）が欠落・重複・意図しない追加を起こしていないかを継続的に検出するテスト。
// GAS APIへ依存する関数を実行する必要はないため、存在・型・宣言数・一覧だけを確認する。
// テスト側で本番関数のロジックを再実装しない（詳細・検証範囲はREADME.mdを参照）。
//
// 実行: node public_functions_test.js
// 失敗時は終了コード1で終わる。

'use strict'

var fs = require('fs')
var path = require('path')
var loadAllGsIntoSandbox_ = require('./load_all_gs_').loadAllGsIntoSandbox_

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

// 末尾が「_」ではない、既存の公開名関数の想定一覧（アルファベット順）
var EXPECTED_PUBLIC_FUNCTIONS = [
  'calcMaisterScore',
  'deleteShiftEntry',
  'deleteShiftWish',
  'doGet',
  'getAllMaisterSummaries',
  'getAllShiftEntries',
  'getAppUrl',
  'getBusinessDayType',
  'getCompanyName',
  'getEmployee',
  'getEmployees',
  'getEmployeeWishPeriodData',
  'getEmployeeWishScreenInitData',
  'getEmployeeWishSubmissionStatus',
  'getEmpMemo',
  'getMaisterBadges',
  'getMaisterDisplayList',
  'getMeisterBulkView',
  'getMeisterTrainingCandidates',
  'getRequestOptions',
  'getShiftEntries',
  'getShiftEntriesForBusinessDate',
  'getShiftWishDisplayById',
  'getShiftWishesForBusinessDate',
  'getTargetEmpRowNumber',
  'getTimeClocks',
  'judgeShiftsForDate',
  'postMaisterBadges',
  'postMemo',
  'postShiftEntry',
  'postShiftEntryFromWish',
  'postShiftWish',
  'postWorkRecord',
  'saveMeisterBulkChanges',
  'submitEmployeeShiftWishesBulk',
  'updateShiftEntry',
  'updateShiftWish'
]

var loaded = loadAllGsIntoSandbox_()
var sandbox = loaded.sandbox

console.log('検証対象: ' + loaded.loadedFiles.join(', '))
console.log('---')

// 1. 想定する36関数がsandbox上でfunctionとして存在する
for (var i = 0; i <= EXPECTED_PUBLIC_FUNCTIONS.length - 1; i++) {
  var name = EXPECTED_PUBLIC_FUNCTIONS[i]
  assertTrue(typeof sandbox[name] === 'function', '1. ' + name + ' が関数として存在する')
}

// 2. app内の全.gsをソース走査し、各公開名関数の宣言がちょうど1回だけ存在する
var appDir = loaded.appDir
var gsFiles = fs.readdirSync(appDir).filter(function (n) { return n.endsWith('.gs') })
var sources = gsFiles.map(function (n) {
  return fs.readFileSync(path.join(appDir, n), 'utf8')
})
var combinedSource = sources.join('\n')

function countDeclarations(fnName, source) {
  var re = new RegExp('^function ' + fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(', 'gm')
  var matches = source.match(re)
  return matches ? matches.length : 0
}

for (var j = 0; j <= EXPECTED_PUBLIC_FUNCTIONS.length - 1; j++) {
  var fnName = EXPECTED_PUBLIC_FUNCTIONS[j]
  var count = countDeclarations(fnName, combinedSource)
  assertEqual(count, 1, '2. ' + fnName + ' の宣言がちょうど1回だけ存在する')
}

// 3. 末尾が「_」ではない関数の一覧が、想定する36個と完全に一致する
var allFunctionDeclRe = /^function ([A-Za-z0-9_]+)\s*\(/gm
var allDeclaredNames = []
var m
while ((m = allFunctionDeclRe.exec(combinedSource)) !== null) {
  allDeclaredNames.push(m[1])
}
var publicNames = allDeclaredNames.filter(function (n) { return n.charAt(n.length - 1) !== '_' })
var uniquePublicNames = publicNames.filter(function (n, idx) { return publicNames.indexOf(n) === idx }).sort()
var expectedSorted = EXPECTED_PUBLIC_FUNCTIONS.slice().sort()

assertEqual(uniquePublicNames, expectedSorted, '3. 末尾が_ではない公開名関数の一覧が想定と完全一致する（想定外の追加・欠落がない）')

console.log('---')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
