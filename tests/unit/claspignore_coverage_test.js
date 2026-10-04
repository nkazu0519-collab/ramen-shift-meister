// .claspignoreの許可リスト（!で始まる行）と、app内に実在する配備対象ファイル（.gs / .html / appsscript.json）を
// 突き合わせ、過不足がないことを確認する。
// - appにあるのに許可リストにないファイル → push対象から漏れるためFAIL
// - 許可リストにあるのにappに実在しないファイル → 存在しないファイルを許可しているだけなのでFAIL
//
// 実行: node claspignore_coverage_test.js
// 失敗時は終了コード1で終わる。

'use strict'

var fs = require('fs')
var path = require('path')

var APP_DIR = path.join(__dirname, '..', '..', 'src')
var CLASPIGNORE_PATH = path.join(APP_DIR, '.claspignore')

var pass = 0, fail = 0
function assertTrue(actual, label) {
  var ok = !!actual
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label)
  if (ok) pass++; else fail++
}

console.log('検証対象: ' + CLASPIGNORE_PATH)
console.log('---')

// .claspignoreから「!」で始まる許可対象ファイル名を抽出する
var claspignoreSource = fs.readFileSync(CLASPIGNORE_PATH, 'utf8')
var allowedFiles = claspignoreSource
  .split(/\r?\n/)
  .map(function (line) { return line.trim() })
  .filter(function (line) { return line.indexOf('!') === 0 })
  .map(function (line) { return line.slice(1).trim() })
  .filter(function (name) { return name.length > 0 })

// app内に実在する配備対象ファイル（.gs / .html / appsscript.json）を列挙する
// ドットファイル（.clasp.json, .claspignore, .gitignore）やMarkdownはclaspの配備対象ではないため対象外
var actualFiles = fs.readdirSync(APP_DIR).filter(function (name) {
  return name.endsWith('.gs') || name.endsWith('.html') || name === 'appsscript.json'
})

var allowedSet = {}
allowedFiles.forEach(function (name) { allowedSet[name] = true })
var actualSet = {}
actualFiles.forEach(function (name) { actualSet[name] = true })

// 1. appに実在するのに許可リストにないファイルがないか
var missingFromAllowlist = actualFiles.filter(function (name) { return !allowedSet[name] })
assertTrue(missingFromAllowlist.length === 0,
  '1. appの配備対象ファイルは全て.claspignoreの許可対象である（不足: ' + JSON.stringify(missingFromAllowlist) + '）')

// 2. 許可リストにあるのにappに実在しないファイルがないか
var missingFromDisk = allowedFiles.filter(function (name) { return !actualSet[name] })
assertTrue(missingFromDisk.length === 0,
  '2. .claspignoreの許可対象は全てapp内に実在する（存在しない: ' + JSON.stringify(missingFromDisk) + '）')

// 3. 許可リスト内に重複がないか
var seen = {}
var duplicates = []
allowedFiles.forEach(function (name) {
  if (seen[name]) duplicates.push(name)
  seen[name] = true
})
assertTrue(duplicates.length === 0,
  '3. .claspignoreの許可対象に重複がない（重複: ' + JSON.stringify(duplicates) + '）')

console.log('---')
console.log('pass=' + pass + ' fail=' + fail)
if (fail > 0) process.exit(1)
