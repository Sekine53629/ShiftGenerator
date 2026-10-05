/**
 * Report.gs — 結果レポートの文字列組み立て
 *
 * 移植元: ShiftAutoPlace.bas の AP_レポート*  仕様書: §4.5
 *
 * 見出し → 個人別 → 警告 の3部構成。ここも SpreadsheetApp を呼ばず、
 * Engine の出力と ShiftAuto が読んだ ctx だけから文字列を組む。
 *
 * 表示は Menu.showReportDialog()（HtmlService のモーダル）。
 * getUi().alert() は長文に向かないので使わない。
 */

const MODULE_REPORT = 'Report';

/**
 * レポート全体を組み立てる。
 * @return {string} プレーンテキストのレポート
 * 移植元: AS_レポート
 */
function buildReport(ctx, output, written) {
  try {
    const lines = [];
    const offset = ctx.carryCount || 0;

    // --- 見出し ---
    const month = (ctx.monthValue instanceof Date)
      ? `${ctx.monthValue.getFullYear()}年${ctx.monthValue.getMonth() + 1}月` : '（不明）';
    lines.push(`対象月    : ${month}`);
    lines.push(`公休ノルマ: ${output.targetOff} 日`);
    lines.push(`対象者    : ${ctx.activeCount} 人`);
    lines.push(`入力範囲  : ${ctx.layout.gridTop}〜${ctx.layout.gridBottom} 行`
      + ` × ${toColumnLetter(ctx.layout.firstCol)}〜${toColumnLetter(ctx.layout.lastCol)} 列`);
    lines.push(`書込セル  : ${written} 個`);
    if (offset > 0) lines.push(`前月の持越: ${offset} 日（連勤・連休の判定に使用）`);
    lines.push(`所要時間  : ${output.elapsedMs} ms`);
    if (ctx.backupName) {
      lines.push(`控え      : ${ctx.backupName}`);
      lines.push('            （シフト → 控えから戻す で元に戻せます）');
    } else {
      lines.push('控え      : ★取れませんでした。戻せません');
    }
    lines.push('');

    // --- 個人別 ---
    lines.push('■ 個人別');
    for (let i = 1; i <= ctx.nP; i++) {
      const m = ctx.members[i - 1];
      if (m.skipRow) continue;
      const st = summarizeMember_(ctx, output, i, offset);
      lines.push(`  ${padName_(m.name)} 出勤${pad_(st.work)} 休${pad_(st.off)}`
        + `(うちノルマ外${pad_(st.paid)}) 連勤max${pad_(st.maxRun)} 連休max${pad_(st.maxOff)}`
        + ` 医5日${pad_(st.busy)} ○${pad_(st.early)} ●${pad_(st.mid)} ▲${pad_(st.late)}`);
    }
    lines.push('');

    // --- 警告 ---
    lines.push('■ 警告');
    const warn = [];
    if (output.unmet.length) {
      warn.push('公休ノルマ未達');
      output.unmet.forEach(function (u) { warn.push(`  ${u}`); });
    }
    pushWarnList_(warn, '設定未登録（自動作成設定に氏名が無い）', ctx.warnings.missing);
    pushWarnList_(warn, '区分が不正（人数計算に入りません）', ctx.warnings.badKind);
    pushWarnList_(warn, '同名の重複（先に見つかった設定が使われます）', ctx.warnings.dupName);
    pushWarnList_(warn, '設定しても読まれない項目', ctx.warnings.ignored);
    pushWarnList_(warn, 'マスタにあるがシフト表に無い氏名', ctx.warnings.orphan);

    const shortDays = countShortDays_(ctx, output, offset);
    if (shortDays.length) {
      warn.push(`必要数に届かない日: ${shortDays.length} 日`);
      warn.push(`  ${shortDays.slice(0, 15).join(' , ')}`);
    }

    const skipped = (output.diagnostics && output.diagnostics.skipped) || [];
    if (skipped.length) {
      warn.push(`未実装のため実行していない工程: ${skipped.join(' / ')}`);
      warn.push('  連勤や人数の偏りが残ります。手で直してください');
    }

    if (warn.length === 0) lines.push('  なし');
    else warn.forEach(function (w) { lines.push(`  ・${w}`); });

    return lines.join('\n');
  } catch (error) {
    logError(MODULE_REPORT, 'buildReport', error, '');
    return `レポートの組み立てに失敗しました。\n${error.message}`;
  }
}

/** 個人1人分の集計。engineOutput の盤面から数え直す */
function summarizeMember_(ctx, output, i, offset) {
  const st = { work: 0, off: 0, paid: 0, maxRun: 0, maxOff: 0, busy: 0,
               early: 0, mid: 0, late: 0 };
  let run = 0;
  let offRun = 0;

  for (let k = 0; k < ctx.nD; k++) {
    const j = offset + k + 1;
    const p = output.plan[i][j];
    const isWork = (p === ST_WORK || p === ST_FWORK);
    const isOff = (p === ST_OFF || p === ST_FOFF);

    if (isWork) {
      st.work++;
      run++;
      if (run > st.maxRun) st.maxRun = run;
      if (ctx.days[k].docCount === DOC_BUSY_N) st.busy++;
      const sym = output.symbol[i][j] || matchWorkSym(ctx.gridValues[i - 1][k]);
      if (sym === SYM.EARLY) st.early++;
      else if (sym === SYM.MID) st.mid++;
      else if (sym === SYM.LATE) st.late++;
    } else {
      run = 0;
    }

    if (isOff) {
      st.off++;
      offRun++;
      if (offRun > st.maxOff) st.maxOff = offRun;
      if (p === ST_FOFF && isPaidOff(ctx.gridValues[i - 1][k], ctx.settings.paidSyms)) st.paid++;
    } else {
      offRun = 0;
    }
  }
  return st;
}

/** 必要数に届かない日を「日付(不足数)」の形で返す */
function countShortDays_(ctx, output, offset) {
  const out = [];
  for (let k = 0; k < ctx.nD; k++) {
    if (!ctx.days[k].inMonth) continue;
    let cov = 0;
    for (let i = 1; i <= ctx.nP; i++) {
      if (ctx.members[i - 1].skipRow) continue;
      if (ctx.members[i - 1].kind !== KIND.PHARM) continue;
      const p = output.plan[i][offset + k + 1];
      if (p === ST_WORK || p === ST_FWORK) cov++;
    }
    const short = ctx.days[k].required - cov;
    if (short > 0) out.push(`${ctx.days[k].date.getDate()}日(-${short})`);
  }
  return out;
}

function pushWarnList_(warn, label, list) {
  if (!list || list.length === 0) return;
  warn.push(`${label}: ${list.length} 件`);
  list.forEach(function (x) { warn.push(`  ${x}`); });
}

function pad_(n) { return String('  ' + n).slice(-2); }
function padName_(s) {
  const t = String(s || '');
  return t.length >= 14 ? t : t + '　'.repeat(Math.ceil((14 - t.length) / 2));
}

/* ================================================================
 *  まだ出していない警告（フェーズ4の残り）
 *
 *  いまのレポートは「公休ノルマ未達 / 設定未登録 / 区分不正 / 同名重複 /
 *  読まれない設定 / 孤児 / 必要数に届かない日 / 未実装の工程」を出す。
 *  下は仕様書 §4.5 が求めているが、まだ出していないもの。
 * ================================================================ */

/**
 * 勤務ルールの検証 — 週N日/固定曜日が守られているかを
 * マクロ自身の週の切り方（日曜起点）で数え直す。
 * 移植元: AP_勤務ルールの検証
 */
function verifyWorkRules_(ctx, output) {
  return notImplemented_(MODULE_REPORT, 'verifyWorkRules_', 4); // TODO(P4)
}

/**
 * 連勤上乗せの影響 — 上乗せ（runBonus）を使った結果、通常上限を超えた人を
 * 必ず名指しで列挙する。労務上の例外なので伏せない。
 * 移植元: AP_連勤上乗せの影響
 */
function reportRunBonusImpact_(ctx, output) {
  return notImplemented_(MODULE_REPORT, 'reportRunBonusImpact_', 4); // TODO(P4)
}

/**
 * 人日収支 — 月の必要人日 vs 出勤人日。
 * 「配分の偏り」か「人手不足」かを利用者に判別させるために出す。
 * 移植元: AP_人日収支
 */
function reportManDayBalance_(ctx, output) {
  return notImplemented_(MODULE_REPORT, 'reportManDayBalance_', 4); // TODO(P4)
}

/** 事務員が不在の日数。移植元: AP_事務員不在日数 */
function countClerkAbsentDays_(ctx, output) {
  return notImplemented_(MODULE_REPORT, 'countClerkAbsentDays_', 4); // TODO(P4)
}

/**
 * 遅番が目標に届かない日数。「目標-1名未満」の日も併せて返す。
 * 移植元: AP_遅番不足日数
 */
function countLateShortDays_(ctx, output) {
  return notImplemented_(MODULE_REPORT, 'countLateShortDays_', 4); // TODO(P4)
}

/** 必要数に届かない日数と、最も不足した日。移植元: AP_必要数不足日数 */
function countCoverShortDays_(ctx, engineOutput) {
  return notImplemented_(MODULE_REPORT, 'countCoverShortDays_', 4); // TODO(P4)
}
