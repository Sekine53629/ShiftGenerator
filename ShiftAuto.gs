/**
 * ShiftAuto.gs — 自動作成の入口・シートの読み書き・Engine の呼び出し
 *
 * 移植元: AutoShiftGenerator.bas の工程 1〜5 と、
 *         ShiftAutoPlace.bas の AS_書き込み / AS_休業行の塗り / AS_レポート
 * 仕様書: §4.3（工程の順序）/ §8.3（読み書きは範囲まるごと1回）
 *
 * 【役割分担】
 *   工程 1〜5   … このファイル（シートを読む）
 *   工程 6〜17  … Engine.gs（SpreadsheetApp を一切呼ばない純粋関数）
 *   工程 18〜20 … このファイル（シートへ書く）
 *
 * 【読み書きの約束（§8.3-3）】
 *   入力欄は getValues / getFormulas で1回だけ読み、setValues で1回だけ書く。
 *   VBA が工程の途中で mGrid.Cells(i,j).Value を読んでいた箇所は、
 *   最初に読んだ配列（existing）を Engine へ渡す形に置き換えてある。
 */

const MODULE_SHIFTAUTO = 'ShiftAuto';

/** 前月から持ち越す日数。連勤・連休の上限判定に足りる長さがあればよい */
const CARRY_OVER_DAYS = 7;

/**
 * 司令塔。メニュー「シフト自動作成」の入口。
 * 移植元: Public Sub シフト自動作成()
 */
function runAutoShift() {
  const started = Date.now();
  try {
    const ctx = prepareContext_();
    buildDayInfo_(ctx);
    readMembers_(ctx);

    if (ctx.activeCount === 0) {
      SpreadsheetApp.getUi().alert(
        `シフト入力欄（${ctx.layout.gridTop}〜${ctx.layout.gridBottom}行）の`
        + 'A列に氏名がありません。\n氏名の記入位置をご確認ください。');
      return null;
    }

    // ★ 書き込む前に控えを取る。自動作成で希望休が消えても戻せるようにする。
    //   控えが取れなくても自動作成は続ける（操作できないほうが困る）
    const backupName = snapshotBeforeChange(ctx.sheet, '自動作成');

    const output = runEngine(buildEngineInput_(ctx));
    const written = writePlanToSheet_(ctx, output);
    ctx.backupName = backupName;
    SpreadsheetApp.flush();

    logSuccess(MODULE_SHIFTAUTO, 'runAutoShift',
      `sheet=${ctx.sheet.getName()}; members=${ctx.activeCount}; days=${ctx.nD}; `
      + `written=${written}; unmet=${output.unmet.length}; `
      + `engineMs=${output.elapsedMs}; backup=${ctx.backupName}; `
      + `elapsedMs=${Date.now() - started}`);

    showReportDialog('シフト自動作成の結果', buildReport(ctx, output, written));
    return output;
  } catch (error) {
    logError(MODULE_SHIFTAUTO, 'runAutoShift', error, '', true);
    SpreadsheetApp.getUi().alert(`自動作成に失敗しました。\n\n${error.message}`);
    throw error;
  }
}

/**
 * 工程1 準備 — シート・設定値・入力欄を解決する。
 * Layout.resolveLayout() は1度だけ呼び、返り値を持ち回る。
 * 移植元: AS_準備
 */
function prepareContext_() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const layout = resolveLayout(sheet);

  const nP = layout.gridBottom - layout.gridTop + 1;
  const nD = layout.lastCol - layout.firstCol + 1;
  if (nP <= 0 || nD <= 0) {
    throw new Error(`入力欄の大きさがおかしいです（${nP} 行 × ${nD} 日）。`);
  }

  // --- 入力欄は1回だけ読む。以降は配列を見る（§8.3-1） ---
  const gridRange = sheet.getRange(layout.gridTop, layout.firstCol, nP, nD);
  const cfgPairs = readSettingPairs();

  return {
    sheet: sheet,
    layout: layout,
    nP: nP,
    nD: nD,
    gridValues: gridRange.getDisplayValues(),
    gridFormulas: gridRange.getFormulas(),
    nameValues: sheet.getRange(layout.gridTop, 1, nP, 1).getValues(),
    docValues: sheet.getRange(layout.docRow, layout.firstCol, 1, nD).getValues()[0],
    dateValues: sheet.getRange(layout.dateRow, layout.firstCol, 1, nD).getValues()[0],
    monthValue: sheet.getRange(layout.headerRow, 1).getValue(),
    settings: readAllSettings_(cfgPairs),
    master: readMemberMaster_(),
    warnings: { missing: [], badKind: [], dupName: [], ignored: [], orphan: [] },
    activeCount: 0,
  };
}

/** 全体設定をまとめて読む。空欄・欠落は既定値へ落ちる（§3.3） */
function readAllSettings_(cfgPairs) {
  return {
    earlyN: readSettingNumber_(cfgPairs, 'earlyN'),
    lateMin: readSettingNumber_(cfgPairs, 'lateMin'),
    maxRun: readSettingNumber_(cfgPairs, 'maxRun'),
    maxOffRun: readSettingNumber_(cfgPairs, 'maxOffRun'),
    weekBase: readSettingNumber_(cfgPairs, 'weekBase'),
    reqPlus: readSettingNumber_(cfgPairs, 'reqPlus'),
    paidSyms: readSettingText_(cfgPairs, 'paidSyms'),
    gSym: readSettingText_(cfgPairs, 'gSym'),
    clerkEarlyN: readSettingNumber_(cfgPairs, 'clerkEarlyN'),
    lateBusy: readSettingNumber_(cfgPairs, 'lateBusy'),
    runBonus: readSettingNumber_(cfgPairs, 'runBonus'),
  };
}

/**
 * 自動作成設定のメンバー表を、氏名をキーにした辞書として読む。
 * シートは1回だけ読む。移植元: AS_メンバー読込 の内側の走査
 */
function readMemberMaster_() {
  const map = {};
  const cfg = getSheetOrNull(CONFIG.SHEET_CFG);
  if (!cfg) return map;

  const last = cfg.getLastRow();
  const rows = last - CFG_MEMBER.FIRST_ROW + 1;
  if (rows <= 0) return map;

  const values = cfg.getRange(CFG_MEMBER.FIRST_ROW, 1, rows, CFG_MEMBER.COL_MEMO).getValues();
  values.forEach(function (row) {
    const name = String(row[CFG_MEMBER.COL_NAME - 1] || '').trim();
    if (name === '' || map[name]) return;    // 先に見つかった設定が適用される
    map[name] = {
      kind: String(row[CFG_MEMBER.COL_KIND - 1] || '').trim(),
      closed: String(row[CFG_MEMBER.COL_CLOSED - 1] || '').trim(),
      rule: String(row[CFG_MEMBER.COL_RULE - 1] || '').trim(),
      fixDow: String(row[CFG_MEMBER.COL_FIXDOW - 1] || '').trim(),
      weekN: Number(row[CFG_MEMBER.COL_WEEKN - 1]) || 0,
      offDay: String(row[CFG_MEMBER.COL_OFFDAY - 1] || '').trim(),
      late: String(row[CFG_MEMBER.COL_LATE - 1] || '').trim(),
    };
  });
  return map;
}

/**
 * 工程2 日情報 — 日付/曜日/祝日/医師数/必要数/公休ノルマ。
 * 移植元: AS_日情報
 */
function buildDayInfo_(ctx) {
  const holidays = loadHolidayMap();
  const monthNum = (ctx.monthValue instanceof Date) ? ctx.monthValue.getMonth() : -1;

  ctx.days = [];
  for (let k = 0; k < ctx.nD; k++) {
    const date = ctx.dateValues[k];
    const isDate = date instanceof Date;
    const inMonth = isDate && date.getMonth() === monthNum;

    const day = {
      date: isDate ? date : null,
      inMonth: inMonth,
      weekday: 0, isHoliday: false, docCount: 0, required: 0, weekKey: 0,
    };

    if (inMonth) {
      day.weekday = date.getDay() + 1;                       // 1=日 .. 7=土
      // 週キーは日曜起点。日付シリアルから曜日ぶんを引く
      day.weekKey = Math.floor(date.getTime() / 86400000) - (day.weekday - 1);
      day.isHoliday = Object.prototype.hasOwnProperty.call(holidays, toDateKey(date));
      day.docCount = Number(ctx.docValues[k]) || 0;
      day.required = day.docCount + ctx.settings.reqPlus;
    }
    ctx.days.push(day);
  }
}

/**
 * 工程3 メンバー読込 — 氏名キーでマスタ照合し、不整合を検出する。
 * 移植元: AS_メンバー読込
 */
function readMembers_(ctx) {
  ctx.members = [];
  ctx.activeCount = 0;
  const seen = {};

  for (let k = 0; k < ctx.nP; k++) {
    const name = String(ctx.nameValues[k][0] || '').trim();
    const m = {
      name: name, kind: KIND.PHARM, rule: RULE.NORMAL, leave: false,
      canLate: true, quota: -1, weekN: 0,
      fixedDow: parseFixedDow(''), skipRow: false,
    };

    if (name === '' || isNonName(name)) {
      m.skipRow = true;
      ctx.members.push(m);
      continue;
    }
    ctx.activeCount++;

    if (seen[name]) {
      if (ctx.warnings.dupName.indexOf(name) < 0) ctx.warnings.dupName.push(name);
    }
    seen[name] = true;

    const cfg = ctx.master[name];
    if (!cfg) {
      ctx.warnings.missing.push(name);
    } else {
      if (cfg.kind !== '') m.kind = cfg.kind;
      if (cfg.rule !== '') m.rule = cfg.rule;
      m.leave = cfg.closed !== '';
      m.fixedDow = parseFixedDow(cfg.fixDow);
      m.weekN = cfg.weekN;
      if (cfg.offDay !== '') m.quota = Number(cfg.offDay) || 0;
      m.canLate = cfg.late !== '不可';

      if (m.kind !== KIND.PHARM && m.kind !== KIND.CLERK) {
        ctx.warnings.badKind.push(`${name} : 区分「${m.kind}」`);
      }
      // 月間休日数は「通常」でしか読まれない。設定しても効かないことを伝える
      if (m.quota >= 0 && m.rule !== RULE.NORMAL) {
        ctx.warnings.ignored.push(
          `${name} : 月間休日数${m.quota}日（勤務ルール「${m.rule}」では読まれません）`);
      }
    }
    ctx.members.push(m);
  }

  // 工程4 孤児検出 — マスタにあるがシフト表に無い氏名
  Object.keys(ctx.master).forEach(function (name) {
    if (!seen[name]) ctx.warnings.orphan.push(name);
  });
}

/**
 * Engine へ渡す入力を組み立てる。
 * 前月の末尾を持ち越して、連勤・連休が月をまたいで正しく繋がるようにする。
 */
function buildEngineInput_(ctx) {
  const carry = readCarryOver_(ctx);

  const days = carry.days.concat(ctx.days);
  const existing = ctx.members.map(function (m, i) {
    const tail = carry.existing[m.name] || [];
    return tail.concat(ctx.gridValues[i].map(function (v) { return String(v || '').trim(); }));
  });

  ctx.carryCount = carry.days.length;

  return {
    settings: ctx.settings,
    days: days,
    members: ctx.members,
    existing: existing,
    // 公休ノルマは月内だけで数える。持ち越しは母数に入らない
    targetOff: undefined,
  };
}

/**
 * 前月のシートから末尾 CARRY_OVER_DAYS 日を読む。
 *
 * 前月のシートが無い・読めない場合は**持ち越し無しで続行する**。
 * 初回や年始で止まらないようにするため。
 *
 * @return {{days:Array, existing:Object<string,string[]>}}
 */
function readCarryOver_(ctx) {
  const empty = { days: [], existing: {} };
  try {
    if (!(ctx.monthValue instanceof Date)) return empty;

    const prev = new Date(ctx.monthValue.getFullYear(), ctx.monthValue.getMonth() - 1, 1);
    const name = Utilities.formatDate(prev, CONFIG.TIMEZONE_HINT,
      SHEET_BUILD.MONTH_SHEET_FORMAT);
    const sheet = getSheetOrNull(name);
    if (!sheet) return empty;

    const layout = resolveLayout(sheet);
    const nP = layout.gridBottom - layout.gridTop + 1;
    const nD = layout.lastCol - layout.firstCol + 1;

    const dates = sheet.getRange(layout.dateRow, layout.firstCol, 1, nD).getValues()[0];
    const grid = sheet.getRange(layout.gridTop, layout.firstCol, nP, nD).getDisplayValues();
    const names = sheet.getRange(layout.gridTop, 1, nP, 1).getValues();
    const prevMonth = prev.getMonth();

    // 月内の日だけを拾い、末尾から必要数だけ残す
    const cols = [];
    for (let k = 0; k < nD; k++) {
      const d = dates[k];
      if (d instanceof Date && d.getMonth() === prevMonth) cols.push(k);
    }
    const use = cols.slice(-CARRY_OVER_DAYS);
    if (use.length === 0) return empty;

    const days = use.map(function (k) {
      const d = dates[k];
      const weekday = d.getDay() + 1;
      return {
        date: d, inMonth: false, locked: true, weekday: weekday,
        isHoliday: false, docCount: 0, required: 0,
        weekKey: Math.floor(d.getTime() / 86400000) - (weekday - 1),
      };
    });

    const existing = {};
    for (let i = 0; i < nP; i++) {
      const nm = String(names[i][0] || '').trim();
      if (nm === '') continue;
      existing[nm] = use.map(function (k) { return String(grid[i][k] || '').trim(); });
    }

    logSuccess(MODULE_SHIFTAUTO, 'readCarryOver_',
      `from=${name}; days=${days.length}`);
    return { days: days, existing: existing };
  } catch (error) {
    // 持ち越しは「あれば良くなる」もの。読めなくても自動作成は続ける
    logError(MODULE_SHIFTAUTO, 'readCarryOver_', error, '');
    return empty;
  }
}

/**
 * 工程18 書き込み — 結果をシートへ書く。
 * 移植元: AS_書き込み
 *
 *   - 空行・集計行（skipRow）には一切書き込まない
 *   - 数式セルは書き換えない
 *   - 既存入力（ST_FWORK / ST_FOFF）はそのまま
 *   - setValues で範囲まるごと1回
 *
 * @return {number} 書き込んだセル数
 */
function writePlanToSheet_(ctx, output) {
  const offset = ctx.carryCount || 0;
  const out = ctx.gridValues.map(function (row) { return row.slice(); });
  let written = 0;

  for (let i = 1; i <= ctx.nP; i++) {
    if (ctx.members[i - 1].skipRow) continue;
    for (let k = 0; k < ctx.nD; k++) {
      const j = offset + k + 1;                 // Engine 側の 1 起点 + 持ち越しぶん
      let value = '';
      if (output.plan[i][j] === ST_OFF) value = SYM.OFF;
      else if (output.plan[i][j] === ST_WORK) value = output.symbol[i][j];
      if (value === '') continue;

      if (ctx.gridFormulas[i - 1][k] !== '') continue;   // 数式は触らない
      if (String(out[i - 1][k] || '').trim() !== value) written++;
      out[i - 1][k] = value;
    }
  }

  ctx.sheet.getRange(ctx.layout.gridTop, ctx.layout.firstCol, ctx.nP, ctx.nD)
    .setValues(out);

  // TODO(P5): ChangeLog へ差分を積む。Web アプリ経由の変更と同じ経路にする
  return written;
}

/**
 * 自動作成の事前診断（実行せずに前提条件だけ調べる）。
 * 移植元: AutoShiftPreflight / ShiftAuto_事前診断
 */
function runPreflightDiagnosis() {
  return notImplemented_(MODULE_SHIFTAUTO, 'runPreflightDiagnosis', 4); // TODO(P4)
}

/**
 * 自動作成設定シートの全体設定（K=ラベル / L=値）を読み出す。
 * 見出し行から CFG_SETTING.SCAN_ROWS 行下まで、K 列と L 列を1回だけ読む。
 * シートが無ければ空配列（呼び出し側は既定値で動く）。
 * @return {Array<Array<*>>} [[ラベル, 値], ...]
 */
function readSettingPairs() {
  try {
    const cfg = getSheetOrNull(CONFIG.SHEET_CFG);
    if (!cfg) return [];
    const top = CFG_SETTING.ROW + 1;
    const rows = Math.min(CFG_SETTING.SCAN_ROWS, Math.max(0, cfg.getMaxRows() - top + 1));
    if (rows <= 0) return [];
    return cfg.getRange(top, CFG_SETTING.COL_KEY, rows, 2).getValues();
  } catch (error) {
    logError(MODULE_SHIFTAUTO, 'readSettingPairs', error, '');
    return [];
  }
}

/**
 * 全体設定から数値を読む。K 列ラベルの部分一致 → L 列の値。
 * 空欄・非数値なら SETTING_DEFAULT にフォールバックする。
 * 既存ブックには新しい設定行が無いため、この挙動は必ず保つこと（§3.3）。
 * 移植元: CfgNum
 */
function readSettingNumber_(cfgPairs, key) {
  const def = SETTING_DEFAULT[key];
  const hit = findSettingRow_(cfgPairs, def.label);
  if (hit === null) return def.value;
  const n = Number(hit);
  return (hit === '' || isNaN(n)) ? def.value : n;
}

/**
 * 全体設定から文字列を読む。空欄なら既定値。
 * 移植元: CfgTxt
 */
function readSettingText_(cfgPairs, key) {
  const def = SETTING_DEFAULT[key];
  const hit = findSettingRow_(cfgPairs, def.label);
  if (hit === null) return String(def.value);
  const s = String(hit).trim();
  return s === '' ? String(def.value) : s;
}

/**
 * K 列ラベルから L 列の値を返す。見つからなければ null。
 *
 * ラベルは利用者が書き換えうるので完全一致だけでは拾えないが、
 * 素朴な部分一致だと **「早番(○) 人数/日」が「事務員の早番(○) 人数/日」の
 * 行に当たってしまう**（一方が他方を丸ごと含んでいるため）。
 * どちらの値も人数なので、取り違えてもエラーにならず黙って誤った人数で組む。
 *
 * そこで段階を分け、確実な一致から順に探す。
 *   1) 完全一致  2) 前方一致  3) 包含（どちら向きでも）
 * 同じ段階で複数当たったら、シートで先に出てきた行を採る。
 */
function findSettingRow_(cfgPairs, label) {
  const keys = cfgPairs.map(function (row) { return String(row[0] || '').trim(); });

  const tiers = [
    function (k) { return k === label; },
    function (k) { return k.indexOf(label) === 0 || label.indexOf(k) === 0; },
    function (k) { return k.indexOf(label) >= 0 || label.indexOf(k) >= 0; },
  ];

  for (let t = 0; t < tiers.length; t++) {
    for (let r = 0; r < keys.length; r++) {
      if (keys[r] !== '' && tiers[t](keys[r])) return cfgPairs[r][1];
    }
  }
  return null;
}

/**
 * 自動作成設定シートの1列を、空欄を除いた文字列の配列として読む。
 * 実名はここを通してしか扱わない（コードには書かない）。
 *
 * @param {number} colNo 読む列（1 起点）
 * @param {number} firstRow 先頭行
 * @param {boolean=} unique 重複を除くか
 * @return {string[]}
 */
function readConfigColumn(colNo, firstRow, unique) {
  try {
    const cfg = getSheetOrNull(CONFIG.SHEET_CFG);
    if (!cfg) return [];
    const rows = Math.max(0, cfg.getLastRow() - firstRow + 1);
    if (rows <= 0) return [];

    const seen = {};
    return cfg.getRange(firstRow, colNo, rows, 1).getValues()
      .map(function (r) { return String(r[0] || '').trim(); })
      .filter(function (name) {
        if (name === '') return false;
        if (!unique) return true;
        if (seen[name]) return false;
        seen[name] = true;
        return true;
      });
  } catch (error) {
    logError(MODULE_SHIFTAUTO, 'readConfigColumn', error, `colNo=${colNo}`);
    return [];
  }
}

/** メンバー氏名を上から順に返す（休業者も含む）。 */
function readMemberNames() {
  return readConfigColumn(CFG_MEMBER.COL_NAME, CFG_MEMBER.FIRST_ROW, false);
}

/**
 * 医師名の候補（§6.4）。**医師マスタが正**。
 *
 * 以前は 自動作成設定 の N 列に間借りしていた。既存ブックとの互換のため、
 * 医師マスタが空のときだけ N 列も見る。実名はコードに書かない。
 *
 * @return {string[]} 表示順に並べた医師名
 */
function readDoctorNames() {
  try {
    const sheet = getSheetOrNull(CONFIG.SHEET_DOCTOR);
    if (sheet) {
      const last = sheet.getLastRow();
      const rows = last - DOCTOR_MASTER.FIRST_ROW + 1;
      if (rows > 0) {
        const values = sheet.getRange(DOCTOR_MASTER.FIRST_ROW, 1, rows,
          DOCTOR_MASTER.HEADS.length).getValues();
        const list = sortByOrder_(values
          .map(function (row) {
            return {
              name: String(row[DOCTOR_MASTER.COL_NAME - 1] || '').trim(),
              order: row[DOCTOR_MASTER.COL_ORDER - 1],
            };
          })
          .filter(function (d) { return d.name !== ''; }))
          .map(function (d) { return d.name; });
        if (list.length > 0) return list;
      }
    }
    // 医師マスタが無い・空のとき。旧い置き場を見る
    return readConfigColumn(CFG_SETTING.COL_DOCTOR, CFG_SETTING.ROW + 1, true);
  } catch (error) {
    logError(MODULE_SHIFTAUTO, 'readDoctorNames', error, '');
    return [];
  }
}

/**
 * シフトパターンのマスタを読む。
 *
 * マスタが無い・空のときは Config の既定から組み立てる。
 * **備考スタンプ（銀行など）は Config に無い**ので、マスタが無ければ出てこない。
 * 「不足シートを生成」を実行すると初期値が入る。
 *
 * @return {Array<{sym:string, name:string, from:string, to:string, kind:string}>}
 */
function readShiftPatterns() {
  try {
    const sheet = getSheetOrNull(CONFIG.SHEET_PATTERN);
    if (sheet) {
      const last = sheet.getLastRow();
      const rows = last - PATTERN_MASTER.FIRST_ROW + 1;
      if (rows > 0) {
        const values = sheet.getRange(PATTERN_MASTER.FIRST_ROW, 1, rows,
          PATTERN_MASTER.HEADS.length).getValues();
        const list = sortByOrder_(values
          .map(function (row) {
            return {
              sym: String(row[PATTERN_MASTER.COL_SYM - 1] || '').trim(),
              name: String(row[PATTERN_MASTER.COL_NAME - 1] || '').trim(),
              from: String(row[PATTERN_MASTER.COL_FROM - 1] || '').trim(),
              to: String(row[PATTERN_MASTER.COL_TO - 1] || '').trim(),
              kind: String(row[PATTERN_MASTER.COL_KIND - 1] || '').trim(),
              order: row[PATTERN_MASTER.COL_ORDER - 1],
            };
          })
          .filter(function (p) { return p.sym !== ''; }));
        if (list.length > 0) return list;
      }
    }
    return defaultShiftPatterns_();
  } catch (error) {
    logError(MODULE_SHIFTAUTO, 'readShiftPatterns', error, '');
    return defaultShiftPatterns_();
  }
}

/**
 * 備考行に押す文字（銀行など）。**備考マスタが正**。
 *
 * 備考マスタが無い・空のときだけ、旧い置き場（シフトパターンの種別「備考」）を
 * 見る。以前このツールは備考をシフトパターンに混ぜていたため、
 * 先に作ったブックとの互換のために残してある。
 *
 * @return {Array<{text:string, desc:string}>} 表示順
 */
function readNoteStamps() {
  try {
    const sheet = getSheetOrNull(CONFIG.SHEET_NOTE);
    if (sheet) {
      const last = sheet.getLastRow();
      const rows = last - NOTE_MASTER.FIRST_ROW + 1;
      if (rows > 0) {
        const values = sheet.getRange(NOTE_MASTER.FIRST_ROW, 1, rows,
          NOTE_MASTER.HEADS.length).getValues();
        const list = sortByOrder_(values
          .map(function (row) {
            return {
              text: String(row[NOTE_MASTER.COL_TEXT - 1] || '').trim(),
              desc: String(row[NOTE_MASTER.COL_DESC - 1] || '').trim(),
              order: row[NOTE_MASTER.COL_ORDER - 1],
            };
          })
          .filter(function (n) { return n.text !== ''; }));
        if (list.length > 0) return list;
      }
    }
    // 旧い置き場との互換。シフトパターンに種別「備考」で入っていたもの
    const legacy = readShiftPatterns()
      .filter(function (p) { return p.kind === PATTERN_MASTER.KIND_NOTE; })
      .map(function (p) { return { text: p.sym, desc: p.name }; });
    if (legacy.length > 0) return legacy;

    return defaultNoteStamps_();
  } catch (error) {
    logError(MODULE_SHIFTAUTO, 'readNoteStamps', error, '');
    return defaultNoteStamps_();
  }
}

/**
 * マスタが無いときの備考スタンプ。Config の初期値から組み立てる。
 *
 * シフトパターンには既定があるのに備考だけ無く、
 * 「不足シートを生成」を実行するまで銀行が出なかった。既定を揃える。
 *
 * **医師名には既定を置かない。**実名をコードに書かないため（Tier 3）。
 * 医師名は登録されるまで出ないのが正しく、画面がその理由を出す。
 */
function defaultNoteStamps_() {
  return NOTE_MASTER.SEED.map(function (row) {
    return {
      text: String(row[NOTE_MASTER.COL_TEXT - 1] || ''),
      desc: String(row[NOTE_MASTER.COL_DESC - 1] || ''),
    };
  });
}

/**
 * マスタが無いときのシフトパターン。Config の記号から組み立てる。
 * 備考は含まない（備考マスタが持つ）。
 */
function defaultShiftPatterns_() {
  const out = [];
  [SYM.EARLY, SYM.MID, SYM.LATE].forEach(function (sym) {
    out.push({ sym: sym, name: sym, from: '', to: '', kind: PATTERN_MASTER.KIND_WORK });
  });
  SYM.OFF_ALL.forEach(function (sym) {
    out.push({ sym: sym, name: sym, from: '', to: '', kind: PATTERN_MASTER.KIND_OFF });
  });
  return out;
}

/**
 * 表示順で並べる。空欄は最後。同じ順のときは元の並びを保つ。
 * SpreadsheetApp を呼ばない純粋関数。
 */
function sortByOrder_(list) {
  return list
    .map(function (item, i) {
      const n = Number(item.order);
      return { item: item, i: i, order: isNaN(n) || item.order === '' ? Infinity : n };
    })
    .sort(function (a, b) {
      if (a.order !== b.order) return a.order - b.order;
      return a.i - b.i;
    })
    .map(function (x) { return x.item; });
}
