/**
 * 週間予定メール（毎週月曜朝）＋ iPhoneショートカット一括登録
 *
 * 流れ
 *  1. 月曜朝、今週(月〜日)の予定一覧をメール送信
 *  2. メール先頭の「iPhoneに登録」ボタンを長押し →「共有…」→「予定追加」
 *     （または「リンクをコピー」してショートカットを実行）
 *  3. 予定の一覧が出るので、登録したいものにチェック → まとめて登録
 *
 * 関数
 *  - sendWeeklySchedule : 本番送信
 *  - sendTestMail       : 動作確認用（ダミー予定3件）
 *  - setupTrigger       : 月曜朝の時間主導トリガーを作成（初回に1回だけ実行）
 *
 * 登録データ：下記JSONを buildToken_() で英数字の1語（WKSCHED...）に変換してメールに載せる
 * 元のJSON形式
 *   {"labels":["01 10/20(火) 10:00 定例", ...],
 *    "events":{"01 10/20(火) 10:00 定例":{"t":"定例","s":"2026/10/20 10:00","e":"2026/10/20 11:00","a":0,"l":"会議室"}, ...}}
 *   - labels : 選択画面に出す表示名（並び順を保つため配列）
 *   - events : 表示名 → 予定データ
 *   - a=1 は終日。終日の場合 s/e は "yyyy/MM/dd"（e は最終日＝その日を含む）
 */

const CONFIG = {
  CALENDAR_ID: 'primary',          // 取得元カレンダーID（'primary' でデフォルトカレンダー）
  TO_ADDRESS: 'xxx@example.com',   // 送信先（iPhoneで受信するアドレス）
  SEND_HOUR: 7,                    // 送信時刻（この時台のどこかで実行される）
  SHORTCUT_NAME: '予定追加',        // iPhone側のショートカット名（案内文に表示するだけ）
};

const DAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];

// 絵文字はGmailApp送信で文字化けするため、HTML数値参照（ASCIIのみ）で埋め込む
const ICON_PIN = '&#x1F4CD;';   // 📍

// 登録データの目印（ショートカット側で WKSCHED の直後の英数字列を抜き出す）
const TOKEN_PREFIX = 'WKSCHED';
// コピー用リンクのURL（中身は # 以降に入れるので、タップしてもデータはサーバーに送られない）
const COPY_LINK_BASE = 'https://example.com/#';

/* ========== メール送信 ========== */

function sendWeeklySchedule() {
  const start = getMondayStart_(new Date());
  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  const cal = CONFIG.CALENDAR_ID === 'primary'
    ? CalendarApp.getDefaultCalendar()
    : CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
  if (!cal) throw new Error(`カレンダーが見つかりません: ${CONFIG.CALENDAR_ID}`);

  const items = cal.getEvents(start, end).map(ev => ({
    title: ev.getTitle() || '(無題)',
    start: ev.getStartTime(),
    end: ev.getEndTime(),
    allDay: ev.isAllDayEvent(),
    location: ev.getLocation() || '',
  }));

  const rangeLabel = `${fmt_(start, 'M/d')}〜${fmt_(new Date(end.getTime() - 1), 'M/d')}`;
  sendMail_(`【今週の予定】${rangeLabel}`, `${rangeLabel} の予定`, items);
}

/** 動作確認用：明日の時刻指定2件＋明後日の終日1件を送る */
function sendTestMail() {
  const d1 = new Date();
  d1.setDate(d1.getDate() + 1);
  const at = (base, h, m) => { const x = new Date(base); x.setHours(h, m, 0, 0); return x; };
  const d2 = new Date(d1);
  d2.setDate(d2.getDate() + 1);
  const d3 = new Date(d2);
  d3.setDate(d3.getDate() + 1);

  sendMail_('【テスト】予定一括登録', 'テスト送信', [
    { title: 'テスト予定A', start: at(d1, 10, 0), end: at(d1, 11, 0), allDay: false, location: 'テスト会議室' },
    { title: 'テスト予定B', start: at(d1, 14, 30), end: at(d1, 15, 0), allDay: false, location: '' },
    { title: 'テスト終日', start: at(d2, 0, 0), end: at(d3, 0, 0), allDay: true, location: '' },
  ]);
}

function sendMail_(subject, heading, items) {
  let html = `<h3>${escHtml_(heading)}（${items.length}件）</h3>`;
  let text = `${heading}（${items.length}件）\n`;

  if (items.length === 0) {
    html += '<p>予定はありません。</p>';
    text += '予定はありません。\n';
    GmailApp.sendEmail(CONFIG.TO_ADDRESS, subject, text, { htmlBody: html });
    return;
  }

  const labels = [];
  const events = {};
  let currentDay = '';
  let listHtml = '';

  items.forEach((it, i) => {
    const dayKey = fmt_(it.start, 'yyyy-MM-dd');
    const dayLabel = `${fmt_(it.start, 'M/d')}（${DAYS_JA[it.start.getDay()]}）`;
    if (dayKey !== currentDay) {
      if (currentDay) listHtml += '</ul>';
      listHtml += `<h4 style="margin:12px 0 4px">${dayLabel}</h4><ul style="margin-top:0;padding-left:18px">`;
      text += `\n■ ${dayLabel}\n`;
      currentDay = dayKey;
    }

    const timeLabel = it.allDay ? '終日' : `${fmt_(it.start, 'HH:mm')}-${fmt_(it.end, 'HH:mm')}`;
    listHtml += `<li style="margin-bottom:6px">${timeLabel} ${escHtml_(it.title)}`
         + (it.location ? `<br><small>${ICON_PIN} ${escHtml_(it.location)}</small>` : '')
         + '</li>';
    text += `  ${timeLabel} ${it.title}${it.location ? ' @' + it.location : ''}\n`;

    // 選択画面用の表示名（番号付きで一意にする）
    const label = `${pad2_(i + 1)} ${fmt_(it.start, 'M/d')}(${DAYS_JA[it.start.getDay()]}) `
                + `${it.allDay ? '終日' : fmt_(it.start, 'HH:mm')} ${it.title}`;
    labels.push(label);
    events[label] = buildEvent_(it);
  });
  if (currentDay) listHtml += '</ul>';

  const token = buildToken_({ labels, events });

  // 登録ボタンは見出しの直後（メール先頭）に置く
  html += `<p style="margin:8px 0 4px"><a href="${COPY_LINK_BASE}${token}" style="display:inline-block;`
       + 'padding:8px 16px;border:1px solid #1a73e8;border-radius:16px;color:#1a73e8;text-decoration:none">'
       + 'iPhoneに登録（長押し）</a></p>'
       + `<p style="margin:0 0 12px;font-size:11px;color:#888">長押し →「共有…」→「${escHtml_(CONFIG.SHORTCUT_NAME)}」`
       + '（または「リンクをコピー」してショートカットを実行）</p>'
       + listHtml;
  text += `\n---- 登録データ ----\n${token}\n`;

  GmailApp.sendEmail(CONFIG.TO_ADDRESS, subject, text, { htmlBody: html });
}

/* ========== 登録データ ========== */

/**
 * 登録データを「英数字と _ だけの1語」に変換する
 *   JSON → UTF-8 → Base64 → '+' を '_p'、'/' を '_s' に置換 → 先頭に WKSCHED
 * ・英数字と _ だけなので、長押しで1語として選択されやすく、URLに入れても変化しない
 * ・Base64の '=' を出さないため、JSONの末尾に空白を足してバイト数を3の倍数にする
 * ショートカット側では逆順（'_p'→'+', '_s'→'/', Base64デコード）で復元する
 */
function buildToken_(obj) {
  let json = JSON.stringify(obj);
  const byteLen = str => Utilities.newBlob(str).getBytes().length;
  while (byteLen(json) % 3 !== 0) json += ' ';
  const b64 = Utilities.base64Encode(json, Utilities.Charset.UTF_8);
  return TOKEN_PREFIX + b64.replace(/\+/g, '_p').replace(/\//g, '_s');
}

function buildEvent_(it) {
  let s, e;
  if (it.allDay) {
    // GASの終日予定の終了は翌日0:00（排他的）なので、1ms戻して最終日にする
    s = fmt_(it.start, 'yyyy/MM/dd');
    e = fmt_(new Date(it.end.getTime() - 1), 'yyyy/MM/dd');
  } else {
    s = fmt_(it.start, 'yyyy/MM/dd HH:mm');
    e = fmt_(it.end, 'yyyy/MM/dd HH:mm');
  }
  return { t: it.title, s, e, a: it.allDay ? 1 : 0, l: it.location };
}

/* ========== トリガー ========== */

function setupTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sendWeeklySchedule')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('sendWeeklySchedule')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(CONFIG.SEND_HOUR)
    .create();
}

/* ========== ユーティリティ ========== */

function getMondayStart_(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // 月曜に戻す
  return x;
}

function fmt_(d, pattern) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), pattern);
}

function pad2_(n) {
  return ('0' + n).slice(-2);
}

function escHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
