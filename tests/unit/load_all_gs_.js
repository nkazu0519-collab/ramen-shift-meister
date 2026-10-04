// app内に現在存在する全.gsファイルを検出し、同一のvmコンテキストへ読み込む共通ヘルパー。
// これ自体はテストではない（assertを持たない、単体では何も検証しない）。
// ファイル分割の途中段階（一部の関数がcode.gs、一部が切り出し先の.gsに分かれている状態）でも、
// 各テストが「今どの関数がどのファイルにあるか」を意識しなくて済むようにするために用意する。
//
// 読み込み順はファイル名のアルファベット順に固定するが、これは実行結果の再現性のためだけであり、
// GASの評価順への依存を作る意図ではない（各.gsはトップレベルに副作用のある即時実行コードを
// 持たない前提であり、関数はすべて呼び出された時点で解決される）。

'use strict'

var fs = require('fs')
var path = require('path')
var vm = require('vm')

var APP_DIR = path.join(__dirname, '..', '..', 'src')

/**
 * app内に存在する全.gsファイルを検出し、同一sandboxへ順に読み込んで返す。
 * 戻り値の sandbox に対して、本番関数をそのままプロパティとして呼び出せる。
 */
function loadAllGsIntoSandbox_(appDir) {
  var dir = appDir || APP_DIR
  var gsFiles = fs.readdirSync(dir)
    .filter(function (name) { return name.endsWith('.gs') })
    .sort()

  var sandbox = { console: console }
  vm.createContext(sandbox)
  for (var i = 0; i < gsFiles.length; i++) {
    var filePath = path.join(dir, gsFiles[i])
    var source = fs.readFileSync(filePath, 'utf8')
    vm.runInContext(source, sandbox, { filename: filePath })
  }
  return { sandbox: sandbox, loadedFiles: gsFiles, appDir: dir }
}

module.exports = {
  APP_DIR: APP_DIR,
  loadAllGsIntoSandbox_: loadAllGsIntoSandbox_
}
