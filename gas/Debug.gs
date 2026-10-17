/**
 * デバッグ用（WeeklySchedule.gs と同じプロジェクトに追加して使う）
 *
 * 使い方：エディタで関数を選んで「実行」→ 下部の「実行ログ」を確認
 *   1. debugEnvironment   : 設定・タイムゾーン・トリガー・送信枠を確認（メールは送らない）
 *   2. debugCalendar      : 今週の予定取得とメール本文のサイズを確認（メールは送らない）
 *   3. debugSendPlain     : 最小構成のテキストメールを送る（送信経路の切り分け）
 *   4. debugRunWeekly     : 本番関数を try/catch 付きで実行し、エラー詳細を記録
 *
 * 3が届かない → 送信先・送信制限・組織ポリシーの問題
 * 手動では届くが月曜に届かない → トリガー側の問題（debugEnvironment と「実行数」画面を確認）
 */

function debugEnvironment() {
  const props = PropertiesService.getScriptProperties();
  Logger.log('--- CONFIG ---');
  Logger.log(JSON.stringify(CONFIG, null, 2));
  if (/example\.com$/.test(CONFIG.TO_ADDRESS)) {
    Logger.log('⚠ TO_ADDRESS がサンプルのままです');
  }

  Logger.log('--- 実行環境 ---');
  Logger.log('スクリプトのタイムゾーン: ' + Session.getScriptTimeZone());
  Logger.log('実行ユーザー: ' + Session.getEffectiveUser().getEmail());
  Logger.log('現在時刻(スクリプトTZ): ' + fmt_(new Date(), 'yyyy/MM/dd HH:mm:ss (E)'));
  Logger.log('本日の残り送信可能数: ' + MailApp.getRemainingDailyQuota());

  Logger.log('--- トリガー ---');
  const triggers = ScriptApp.getProjectTriggers();
  if (triggers.length === 0) Logger.log('⚠ トリガーが1つもありません（setupTrigger 未実行）');
  triggers.forEach(t => {
    Logger.log(`関数=${t.getHandlerFunction()} / 種類=${t.getEventType()} / ID=${t.getUniqueId()}`);
  });

  Logger.log('--- 前回の実行記録（debugRunWeekly / トリガー実行） ---');
  Logger.log('LAST_RUN: ' + (props.getProperty('LAST_RUN') || '(なし)'));
  Logger.log('LAST_ERROR: ' + (props.getProperty('LAST_ERROR') || '(なし)'));
}

function debugCalendar() {
  const start = getMondayStart_(new Date());
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  Logger.log(`取得範囲: ${fmt_(start, 'yyyy/MM/dd HH:mm')} 〜 ${fmt_(end, 'yyyy/MM/dd HH:mm')}`);

  const cal = CONFIG.CALENDAR_ID === 'primary'
    ? CalendarApp.getDefaultCalendar()
    : CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
  if (!cal) {
    Logger.log('⚠ カレンダーが取得できません: ' + CONFIG.CALENDAR_ID);
    return;
  }
  Logger.log('カレンダー名: ' + cal.getName() + ' / ID: ' + cal.getId());

  const events = cal.getEvents(start, end);
  Logger.log('予定件数: ' + events.length);

  let totalUrlLen = 0;
  events.forEach((ev, i) => {
    const it = {
      title: ev.getTitle() || '(無題)',
      start: ev.getStartTime(),
      end: ev.getEndTime(),
      allDay: ev.isAllDayEvent(),
      location: ev.getLocation() || '',
    };
    const len = JSON.stringify(buildEvent_(it)).length;
    totalUrlLen += len;
    Logger.log(`#${i + 1} ${fmt_(it.start, 'MM/dd HH:mm')} ${it.title} (終日=${it.allDay}) データ長=${len}`);
  });
  Logger.log('登録データ合計文字数(概算): ' + totalUrlLen);
}

function debugSendPlain() {
  const subject = '【デバッグ】テキストのみ ' + fmt_(new Date(), 'HH:mm:ss');
  GmailApp.sendEmail(CONFIG.TO_ADDRESS, subject, 'テキストのみのテストメールです。');
  Logger.log('送信API呼び出し成功: ' + subject + ' → ' + CONFIG.TO_ADDRESS);
  logSentCheck_(subject);
}

/** 本番関数をエラー記録付きで実行（トリガーの登録先をこちらに変えて使ってもよい） */
function debugRunWeekly() {
  const props = PropertiesService.getScriptProperties();
  const now = fmt_(new Date(), 'yyyy/MM/dd HH:mm:ss');
  try {
    sendWeeklySchedule();
    props.setProperty('LAST_RUN', now + ' 成功');
    props.deleteProperty('LAST_ERROR');
    Logger.log('成功');
  } catch (err) {
    const msg = `${now} ${err.name}: ${err.message}\n${err.stack || ''}`;
    props.setProperty('LAST_RUN', now + ' 失敗');
    props.setProperty('LAST_ERROR', msg.slice(0, 8000));
    Logger.log('⚠ 失敗\n' + msg);
    throw err; // 実行数画面にも「失敗」として残す
  }
}

/** 自分の「送信済み」に残っているかを確認（送信先が自分の場合は受信側も兼ねる） */
function logSentCheck_(subject) {
  Utilities.sleep(3000);
  const threads = GmailApp.search(`in:sent subject:"${subject}"`, 0, 1);
  Logger.log(threads.length > 0
    ? '送信済みフォルダに存在 → 送信自体は成功。受信側（迷惑メール・転送・フィルタ）を確認'
    : '⚠ 送信済みフォルダに見つからない（反映遅延の可能性もあるので数分後にGmailで再確認）');
}
