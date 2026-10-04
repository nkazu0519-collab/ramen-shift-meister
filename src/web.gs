/**
 * ページを開いた時に最初に呼ばれるルートメソッド
 * ?page=meister は店主用の「マイスター一括管理」（独立ページ、selectedEmpId等には依存しない）。
 * ?page=wish は従業員用の「希望シフト提出」（独立ページ。確認用の従業員選択のみで、
 * ログイン・権限制御ではない。詳細はemployee_shift_wish.gs・view_employee_wish.html）。
 * ?page=wish-status は店主用の「希望シフト提出状況」（独立ページ、表示専用。
 * 詳細はemployee_shift_wish.gs・view_wish_status.html・希望シフト提出状況_最小仕様.md）。
 * empIdの有無で判定する既存の分岐より先に見るだけで、empId側のロジックには一切手を入れていない。
 */
function doGet(e) {
  var page = e.parameter.page
  if (page === 'meister') {
    return HtmlService.createTemplateFromFile("view_meister_bulk")
      .evaluate().setTitle("マイスター一括管理")
  }
  if (page === 'wish') {
    return HtmlService.createTemplateFromFile("view_employee_wish")
      .evaluate().setTitle("希望シフト提出")
  }
  if (page === 'wish-status') {
    return HtmlService.createTemplateFromFile("view_wish_status")
      .evaluate().setTitle("希望シフト提出状況")
  }
  var selectedEmpId = e.parameter.empId
  if (selectedEmpId == undefined) {
    // empIdがセットされていない場合にはホーム画面を表示
    return HtmlService.createTemplateFromFile("view_home")
      .evaluate().setTitle("Home")
  }
  // 選択した従業員IDを後続の処理でも利用するためにPropertyに保存
  PropertiesService.getUserProperties().setProperty('selectedEmpId', selectedEmpId.toString())
  // 従業員の詳細画面を表示
  return HtmlService.createTemplateFromFile("view_detail")
      .evaluate().setTitle("Detail: " + selectedEmpId.toString())
}

/**
 * このアプリのURLを返す
 */
function getAppUrl() {
  return ScriptApp.getService().getUrl();
}

/**
 * 全画面共通の左ナビゲーションを描画する。
 * 項目追加時に各viewを個別修正せず、app_sidebar.htmlだけを更新できるよう部分テンプレート化する。
 */
function renderAppSidebar_(activePage) {
  var template = HtmlService.createTemplateFromFile('app_sidebar')
  template.activePage = activePage
  return template.evaluate().getContent()
}
