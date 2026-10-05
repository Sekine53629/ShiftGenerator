/**
 * Engine.gs — 配置エンジン（★最重要）
 *
 * 移植元: ShiftAutoPlace v9.13.0 + AutoShiftGenerator の工程 6〜11 +
 *         ShiftAutoLog の計測ヘルパー
 * 仕様書: §4（工程と各工程の仕様）/ §8（実行時間）/ §10（罠チェックリスト）
 *
 * ┌────────────────────────────────────────────────┐
 * │ 【絶対の約束】このファイルは SpreadsheetApp を一切呼ばない。   │
 * │ 呼んだ時点で 6 分制限に当たり、テストも書けなくなる（§8.3-1）。 │
 * └────────────────────────────────────────────────┘
 *
 * VBA 版が工程の途中で mGrid.Cells(i,j).Value を読んでいた箇所
 * （AS_公休ノルマ の IsPaidOff 判定 / AP_既存記号を数える / AP_日別既存数 /
 *   AP_日別遅番数 / AP_レポート個人別）は、すべて input.existing[][] を
 * 参照する形に置き換えること。ここを見落とすと API 呼び出しが数万回になる。
 *
 * 【移植の検証（§9 フェーズ3）】
 *   VBA 版と同じ入力を与えて同じ出力になるかを突き合わせる。
 *   差が出たらエンジン側のバグとして扱い、アルゴリズムを「改善」しない。
 */

const MODULE_ENGINE = 'Engine';

/**
 * 配置エンジンの入口。純粋関数（同じ入力なら必ず同じ出力）。
 *
 * @param {{
 *   settings: {earlyN:number, lateMin:number, maxRun:number, maxOffRun:number,
 *              weekBase:number, reqPlus:number, paidSyms:string, gSym:string,
 *              clerkEarlyN:number, lateBusy:number, runBonus:number},
 *   days: Array<{date:Date, inMonth:boolean, weekday:number, isHoliday:boolean,
 *                docCount:number, required:number, weekKey:number,
 *                locked:boolean=}>,
 *   members: Array<{name:string, kind:string, rule:string, leave:boolean,
 *                   canLate:boolean, quota:number, weekN:number,
 *                   fixedDow:boolean[], skipRow:boolean}>,
 *   existing: string[][]
 * }} input 行×日の生データ。weekday は 1=日..7=土。quota の -1 は未指定
 * @return {{plan:number[][], symbol:string[][],
 *           counts:{cntE:number[], cntM:number[], cntL:number[]},
 *           targetOff:number, unmet:string[],
 *           diagnostics:{coverBalance:Object, fiveBalance:Object}}}
 */
function runEngine(input) {
  const started = Date.now();
  try {
    const state = buildState_(input);

    // --- 必須の工程。ここが欠けるとシフト表にならない ---
    classifyExisting_(state);      // 6  既存分類
    applyMemberRules_(state);      // 7  ルール適用
    countCoverage_(state);         // 8  予定出勤数
    applyWeekNRule_(state);        // 9  週N日ルール
    buildWeekList_(state);         // 10 週リスト
    placeOffQuota_(state);         // 11 公休ノルマ
    placeRemainingQuota_(state);   // 12 残ノルマ配置

    // --- 品質を上げる工程。無くてもシフトは出る（手で直せる） ---
    runRefinementStage_(state, '連勤緩和', relaxWorkRuns_);        // 13
    runRefinementStage_(state, 'CoverBalance', coverBalance_);     // 14
    runRefinementStage_(state, 'FiveBalance', fiveBalance_);       // 15

    assignSymbols_(state);         // 16 記号割当（必須）

    runRefinementStage_(state, 'SymbolBalance', symbolBalance_);   // 17

    return {
      plan: state.plan,
      symbol: state.symbol,
      counts: { cntE: state.cntE, cntM: state.cntM, cntL: state.cntL },
      targetOff: state.targetOff,
      unmet: state.unmet,
      diagnostics: state.diagnostics,
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    // 内側の純粋関数は try/catch を持たない。ここで一括して捕える
    logError(MODULE_ENGINE, 'runEngine', error,
      `nP=${input && input.members && input.members.length}; `
      + `nD=${input && input.days && input.days.length}`);
    throw error;
  }
}

/**
 * 品質を上げる工程を、未実装でも止まらずに走らせる。
 *
 * 工程13〜15・17 は無くてもシフトは出る（連勤や人数の偏りが残るが手で直せる）。
 * 移植の途中でも通しで動かせるように、**未実装だけを飲み込んで先へ進む**。
 * 飲み込んだことは diagnostics に残し、レポートで「実行していない」と言えるようにする。
 *
 * 未実装以外の例外は握り潰さない。バグを見えなくするため。
 *
 * @return {boolean} 実行できたら true
 */
function runRefinementStage_(state, label, fn) {
  try {
    fn(state);
    return true;
  } catch (error) {
    const message = String((error && error.message) || '');
    if (message.indexOf('未実装') === 0) {
      if (!state.diagnostics.skipped) state.diagnostics.skipped = [];
      state.diagnostics.skipped.push(label);
      return false;
    }
    throw error;
  }
}

/**
 * 入力から作業用の状態を組み立てる。
 *
 * **配列は 1 起点にする。**VBA と同じ添字にしておかないと、
 * 記号割当の `i = ((j + k - 1) % nP) + 1` のような 1 起点前提の式を
 * 書き換えることになり、そこが移植のバグの温床になる。0 番は使わない。
 *
 * @param {Object} input runEngine の引数
 * @return {Object} state
 */
function buildState_(input) {
  const members = input.members || [];
  const days = input.days || [];
  const nP = members.length;
  const nD = days.length;

  // 0 起点の配列を 1 起点へ写す
  const fromMembers = function (pick) {
    const a = [null];
    for (let k = 0; k < nP; k++) a.push(pick(members[k]));
    return a;
  };
  const fromDays = function (pick) {
    const a = [null];
    for (let k = 0; k < nD; k++) a.push(pick(days[k]));
    return a;
  };
  const filled = function (n, v) {
    const a = [null];
    for (let k = 1; k <= n; k++) a.push(v);
    return a;
  };
  const grid = function (v) {
    const a = [null];
    for (let i = 1; i <= nP; i++) a.push(filled(nD, v));
    return a;
  };

  const existing = [null];
  for (let i = 0; i < nP; i++) {
    const row = [null];
    const src = (input.existing && input.existing[i]) || [];
    for (let j = 0; j < nD; j++) row.push(String(src[j] == null ? '' : src[j]));
    existing.push(row);
  }

  const state = {
    settings: input.settings,
    nP: nP,
    nD: nD,

    name: fromMembers(function (m) { return m.name; }),
    kind: fromMembers(function (m) { return m.kind; }),
    rule: fromMembers(function (m) { return m.rule; }),
    leave: fromMembers(function (m) { return !!m.leave; }),
    canLate: fromMembers(function (m) { return m.canLate !== false; }),
    skipRow: fromMembers(function (m) { return !!m.skipRow; }),
    quota: fromMembers(function (m) { return m.quota === undefined ? -1 : m.quota; }),
    weekN: fromMembers(function (m) { return m.weekN || 0; }),
    fixedDow: fromMembers(function (m) {
      return m.fixedDow || [false, false, false, false, false, false, false, false];
    }),

    dayDt: fromDays(function (d) { return d.date; }),
    dayIn: fromDays(function (d) { return !!d.inMonth; }),
    // 前月から持ち越した日。月内ではないが、連勤・連休の判定には参加する
    dayLocked: fromDays(function (d) { return !!d.locked; }),
    dayWD: fromDays(function (d) { return d.weekday; }),
    dayHol: fromDays(function (d) { return !!d.isHoliday; }),
    dayDoc: fromDays(function (d) { return d.docCount || 0; }),
    dayReq: fromDays(function (d) { return d.required || 0; }),
    wkKey: fromDays(function (d) { return d.weekKey; }),

    existing: existing,
    plan: grid(ST_NONE),
    symbol: grid(''),
    cov: filled(nD, 0),
    covG: filled(nD, 0),
    cntE: filled(nP, 0),
    cntM: filled(nP, 0),
    cntL: filled(nP, 0),
    remOff: filled(nP, 0),

    wkList: [null],
    nW: 0,
    unmet: [],
    diagnostics: {},
  };

  state.targetOff = (input.targetOff === undefined)
    ? countTargetOff_(state) : input.targetOff;
  return state;
}

/**
 * 公休ノルマ（土日 + 平日の祝日の日数）。移植元: AS_日情報 の該当部
 * 祝日が土日に重なっても二重に数えない（仕様書 §4.4）。
 */
function countTargetOff_(state) {
  let n = 0;
  for (let j = 1; j <= state.nD; j++) {
    if (!state.dayIn[j]) continue;
    const wd = state.dayWD[j];
    if (wd === 1 || wd === 7) n++;          // 日曜・土曜
    else if (state.dayHol[j]) n++;          // 平日の祝日
  }
  return n;
}

/* ================================================================
 *  工程 6〜11（移植元: AutoShiftGenerator.bas の AS_*）
 * ================================================================ */

/**
 * 工程6 既存分類 — 入力済みセルを ST_FWORK / ST_FOFF に分類する。
 *   ○ ◯ ● ▲ → ST_FWORK / それ以外の非空文字 → ST_FOFF / 空白 → ST_NONE
 * 【不変条件】ST_FWORK / ST_FOFF は以降の工程で絶対に書き換えない。
 * 移植元: AS_既存分類
 */
function classifyExisting_(state) {
  for (let i = 1; i <= state.nP; i++) {
    for (let j = 1; j <= state.nD; j++) {
      // ★ locked（前月からの持ち越し）は月外だが対象外にしない。
      //   既存入力として置いておくと、連勤・連休が月をまたいで正しく繋がる。
      //   配置する工程はどれも ST_WORK しか触らないので、書き換えられる心配は無い
      if (state.skipRow[i] || state.leave[i]
        || (!state.dayIn[j] && !state.dayLocked[j])) {
        state.plan[i][j] = ST_SKIP;
        continue;
      }
      const v = String(state.existing[i][j] || '').trim();
      if (v === '') {
        state.plan[i][j] = ST_NONE;
      } else if (matchWorkSym(v) !== '') {
        state.plan[i][j] = ST_FWORK;
      } else {
        state.plan[i][j] = ST_FOFF;      // 希休・有休・公休など
      }
    }
  }
}

/**
 * 工程7 ルール適用 — 固定曜日 / 手動=触らない / それ以外は仮で全出勤。
 * 移植元: AS_ルール適用
 */
function applyMemberRules_(state) {
  for (let i = 1; i <= state.nP; i++) {
    if (state.skipRow[i] || state.leave[i]) continue;

    if (state.rule[i] === RULE.FIXED_DOW) {
      for (let j = 1; j <= state.nD; j++) {
        if (state.plan[i][j] !== ST_NONE) continue;
        state.plan[i][j] = state.fixedDow[i][state.dayWD[j]] ? ST_WORK : ST_OFF;
      }
    } else if (state.rule[i] === RULE.MANUAL) {
      // 手動は触らない。未決（ST_NONE）のまま残り、以降の工程も埋めない
    } else {
      for (let j = 1; j <= state.nD; j++) {
        if (state.plan[i][j] === ST_NONE) state.plan[i][j] = ST_WORK;
      }
    }
  }
}

/**
 * 工程8 予定出勤数 — 日ごとの出勤数を薬剤師(cov)と事務員(covG)で別に数える。
 * 移植元: AS_予定出勤数
 */
function countCoverage_(state) {
  for (let j = 1; j <= state.nD; j++) {
    state.cov[j] = 0;
    state.covG[j] = 0;
    for (let i = 1; i <= state.nP; i++) {
      if (state.skipRow[i]) continue;
      if (!isWorkState_(state.plan[i][j])) continue;
      if (state.kind[i] === KIND.PHARM) state.cov[j]++;
      else if (state.kind[i] === KIND.CLERK) state.covG[j]++;
    }
  }
}

/**
 * 工程9 週N日ルール — 週ごとの勤務日数を指定数まで絞る。
 * 移植元: AS_週N日ルール
 */
function applyWeekNRule_(state) {
  for (let i = 1; i <= state.nP; i++) {
    if (state.skipRow[i] || state.leave[i]) continue;
    if (state.rule[i] !== RULE.WEEK_N || state.weekN[i] <= 0) continue;

    const processed = [];
    for (let j0 = 1; j0 <= state.nD; j0++) {
      if (!state.dayIn[j0] || processed[j0]) continue;

      // この週の月内日数と、既に出勤で埋まっている日数を数える
      let cnt = 0;
      let fixedWork = 0;
      for (let j = 1; j <= state.nD; j++) {
        if (!state.dayIn[j] || state.wkKey[j] !== state.wkKey[j0]) continue;
        processed[j] = true;
        cnt++;
        if (state.plan[i][j] === ST_FWORK) fixedWork++;
      }

      // 端週は日数が少ないので、週N日を日数で按分する。四捨五入
      let target = Math.floor(state.weekN[i] * cnt / 7 + 0.5);
      if (target > cnt) target = cnt;

      // 多すぎる分を、休みにする価値が高い日から順に落とす
      for (;;) {
        let autoWork = 0;
        for (let j = 1; j <= state.nD; j++) {
          if (state.dayIn[j] && state.wkKey[j] === state.wkKey[j0]
            && state.plan[i][j] === ST_WORK) autoWork++;
        }
        if (fixedWork + autoWork <= target) break;

        let best = 0;
        let bestScore = ENGINE_LIMIT.SCORE_INF;
        for (let j = 1; j <= state.nD; j++) {
          if (state.dayIn[j] && state.wkKey[j] === state.wkKey[j0]
            && state.plan[i][j] === ST_WORK) {
            const sc = offScore_(state, i, j);
            if (sc > bestScore) { bestScore = sc; best = j; }
          }
        }
        if (best === 0) break;   // 落とせる日が無い

        state.plan[i][best] = ST_OFF;
        covAdd_(state, i, best, -1);
      }
    }
  }
}

/**
 * 工程10 週リスト — 日曜起点の週キーを昇順に並べる。
 *   weekKey = 日付シリアル - (曜日(日=1) - 1)
 * 移植元: AS_週リスト
 */
function buildWeekList_(state) {
  state.wkList = [null];
  state.nW = 0;
  for (let j = 1; j <= state.nD; j++) {
    if (!state.dayIn[j]) continue;
    let exists = false;
    for (let w = 1; w <= state.nW; w++) {
      if (state.wkList[w] === state.wkKey[j]) { exists = true; break; }
    }
    if (!exists) {
      state.nW++;
      state.wkList[state.nW] = state.wkKey[j];
    }
  }
}

/**
 * 工程11 公休ノルマ — 週の基本休を置き、余剰は連休化する。
 *
 * 仕様（§4.4）:
 *   1. remOff = quota - (ノルマ対象の既存休の数)。quota 未指定なら targetOff。
 *      ノルマ外の休み記号（既定 有休・夏休）に部分一致するものは数えない。
 *   2. 週ごとの目標休日数 tW を組む。
 *      tW = weekBase - (その週の既存休)、その週の残り日数を超えない。
 *      その週の月内日数が2日以下なら tW は最大1（月初/月末の端週）。
 *      合計が remOff を超えるなら後ろの週から1ずつ削る（最大100巡）。
 *      足りないなら前の週から1ずつ足す（maxOffRun が上限。最大100巡）。
 *   3. 週ごとに 3連休 → 2連休 → 単発 の順で置く。
 * 移植元: AS_公休ノルマ
 */
function placeOffQuota_(state) {
  // --- 1. 各人の残ノルマ ---
  for (let i = 1; i <= state.nP; i++) {
    state.remOff[i] = 0;
    if (state.skipRow[i] || state.leave[i]) continue;
    // ★ 月間休日数は「通常」ルールでしか読まない（仕様書 §4.4）。
    //   週N日・固定曜日の人は、そちらのルールで休みが決まる
    if (state.rule[i] !== RULE.NORMAL) continue;

    const quota = state.quota[i] < 0 ? state.targetOff : state.quota[i];

    // 既にある休みのうち、ノルマ対象のものを数える。
    // ノルマ外の記号（既定 有休・夏休）は数えない
    let offN = 0;
    for (let j = 1; j <= state.nD; j++) {
      // ★ 持ち越しの日を数えるとノルマを食ってしまう。月内だけを数える。
      //   VBA では月外が ST_SKIP なのでこの守りが要らなかった
      if (!state.dayIn[j]) continue;
      if (state.plan[i][j] !== ST_FOFF) continue;
      const v = String(state.existing[i][j] || '').trim();
      if (!isPaidOff(v, state.settings.paidSyms)) offN++;
    }

    state.remOff[i] = Math.max(0, quota - offN);
  }

  // --- 2. 週ごとの目標休日数を組み、3連休 → 2連休 → 単発 の順で置く ---
  for (let i = 1; i <= state.nP; i++) {
    if (state.remOff[i] <= 0) continue;
    const need = state.remOff[i];
    const tW = buildWeeklyOffTargets_(state, i, need);

    for (let w = 1; w <= state.nW; w++) {
      let n = Math.min(tW[w], state.remOff[i]);

      // まとまった休みから置く。3連休が取れなければ2連休
      while (n >= 2) {
        let placedBlock = false;
        if (n >= 3 && placeOffBlock_(state, i, state.wkList[w], 3)) {
          state.remOff[i] -= 3;
          n -= 3;
          placedBlock = true;
        }
        if (!placedBlock) {
          if (placeOffBlock_(state, i, state.wkList[w], 2)) {
            state.remOff[i] -= 2;
            n -= 2;
          } else {
            break;
          }
        }
      }
      // 残りは単発
      while (n > 0) {
        if (!placeOffSingle_(state, i, state.wkList[w])) break;
        state.remOff[i]--;
        n--;
      }
    }
  }
}

/**
 * 週ごとの目標休日数 tW を組む。移植元: AS_公休ノルマ の中段
 *
 *   tW = weekBase - その週の既存休。ただしその週の残り日数を超えない
 *   月内日数が2日以下の端週は最大1
 *   合計が残ノルマを超えるなら後ろの週から1ずつ削る（最大100巡）
 *   足りないなら前の週から1ずつ足す（maxOffRun が上限。最大100巡）
 *
 * @return {number[]} 1 起点。添字は週の並び順
 */
function buildWeeklyOffTargets_(state, i, need) {
  const tW = [null];
  let sum = 0;

  for (let w = 1; w <= state.nW; w++) {
    let already = 0;
    let daysInWeek = 0;
    for (let j = 1; j <= state.nD; j++) {
      if (!state.dayIn[j] || state.wkKey[j] !== state.wkList[w]) continue;
      daysInWeek++;
      if (state.plan[i][j] === ST_FOFF || state.plan[i][j] === ST_OFF) already++;
    }

    let t = state.settings.weekBase - already;
    if (t > daysInWeek - already) t = daysInWeek - already;
    if (daysInWeek <= 2 && t > 1) t = 1;      // 月初・月末の端週
    if (t < 0) t = 0;

    tW[w] = t;
    sum += t;
  }

  // 多すぎる分を後ろの週から削る
  let guard = 0;
  while (sum > need && guard < ENGINE_LIMIT.OFF_QUOTA_MAX_PASS) {
    for (let w = state.nW; w >= 1; w--) {
      if (sum > need && tW[w] > 0) { tW[w]--; sum--; }
    }
    guard++;
  }

  // 足りない分を前の週から足す。1週に maxOffRun より多くは置かない
  guard = 0;
  while (sum < need && guard < ENGINE_LIMIT.OFF_QUOTA_MAX_PASS) {
    let added = false;
    for (let w = 1; w <= state.nW; w++) {
      if (sum < need && tW[w] < state.settings.maxOffRun) {
        tW[w]++;
        sum++;
        added = true;
      }
    }
    if (!added) break;
    guard++;
  }

  return tW;
}

/* ================================================================
 *  工程 12〜17（移植元: ShiftAutoPlace.bas）
 * ================================================================ */

/**
 * 工程12 残ノルマ配置 — 残りを offScore + adjBonus が最大の出勤日へ1日ずつ。
 * 置けなくなったら unmet に「あとn日 配置できず」を記録して打ち切る（誤差0厳守）。
 * 移植元: AS_残ノルマ配置
 */
function placeRemainingQuota_(state) {
  // ★ 1人1日ずつの総当たり。1人が一気に置ききると、その人だけ都合のよい日を
  //   先取りしてしまう。VBA も外側のループで1周ずつ回している
  let moved = true;
  while (moved) {
    moved = false;
    for (let i = 1; i <= state.nP; i++) {
      if (state.remOff[i] <= 0) continue;

      let best = 0;
      let bestScore = ENGINE_LIMIT.SCORE_INF;
      for (let j = 1; j <= state.nD; j++) {
        if (state.plan[i][j] !== ST_WORK) continue;
        const sc = offScore_(state, i, j) + adjBonus_(state, i, j);
        if (sc > bestScore) { bestScore = sc; best = j; }
      }

      if (best > 0) {
        state.plan[i][best] = ST_OFF;
        covAdd_(state, i, best, -1);
        state.remOff[i]--;
        moved = true;
      } else {
        // 置ける日が無い。誤差0を保つため、残りを未達として記録して打ち切る
        state.unmet.push(`・${state.name[i]} : あと${state.remOff[i]}日 配置できず`);
        state.remOff[i] = 0;
      }
    }
  }
}

/**
 * 工程13 連勤緩和 — 連勤上限超えを入替で緩和（最大 REPAIR_RUNS_PASS 巡）。
 * 移植元: AS_連勤緩和
 */
function relaxWorkRuns_(state) {
  return notImplemented_(MODULE_ENGINE, 'relaxWorkRuns_', 3); // TODO(P3)
}

/**
 * 工程16 記号割当 — ○ → ▲ → 残りを ● ▲ で均等。
 * 移植元: AS_記号割当
 */
function assignSymbols_(state) {
  for (let i = 1; i <= state.nP; i++) {
    state.cntE[i] = 0;
    state.cntM[i] = 0;
    state.cntL[i] = 0;
    for (let j = 1; j <= state.nD; j++) state.symbol[i][j] = '';
  }

  countExistingSymbols_(state);

  for (let j = 1; j <= state.nD; j++) {
    if (!state.dayIn[j]) continue;
    assignPharmSymbols_(state, j);
    assignClerkSymbols_(state, j);
    assignRestAsEarly_(state, j);
  }
}

/**
 * その日を休みにする良さ（大きいほど休み向き）。式は §4.4 のとおり一字も変えない。
 * 移植元: OffScore
 * @return {number}
 */
function offScore_(state, i, j) {
  let s = 0;

  if (state.kind[i] === KIND.PHARM) {
    s += 5.0 * (state.cov[j] - 1 - state.dayReq[j]);          // 不足を日別に均す（ソフト）
    if (state.dayDoc[j] === DOC_BUSY_N) {
      s += 3.0 * (fiveCnt_(state, i) - fiveAvg_(state));
    }
  } else if (state.kind[i] === KIND.CLERK) {
    if (state.covG[j] - 1 < 1) s -= 12;                       // 事務員ゼロの日は強く回避
    else s += 4.0 * (state.covG[j] - 2);                      // 重なる日を優先して休みに
  }

  const run = runLenAt_(state, i, j);
  if (run.len >= state.settings.maxRun + 1) {
    s += 8 + Math.min(run.lft, run.rgt);
  }
  if (state.dayWD[j] === 1 || state.dayWD[j] === 7 || state.dayHol[j]) s += 2;

  return s;
}

/**
 * 既存休に隣接して連休になる位置を優遇する加点。
 *   total = 1 + offRunBefore + offRunAfter
 *   2 <= total <= maxOffRun → +4 / total > maxOffRun → -3 * (total - maxOffRun)
 * 移植元: AdjBonus
 */
function adjBonus_(state, i, j) {
  const total = 1 + offRunBefore_(state, i, j) + offRunAfter_(state, i, j);
  const maxOffRun = state.settings.maxOffRun;
  if (total >= 2 && total <= maxOffRun) return 4;
  if (total > maxOffRun) return -3 * (total - maxOffRun);
  return 0;
}

/** 連休ブロック（3連休/2連休）を1つ置く。移植元: PlaceOffBlock */
function placeOffBlock_(state, i, weekKey, size) {
  let best = 0;
  let bestScore = ENGINE_LIMIT.SCORE_INF;

  for (let j = 1; j <= state.nD - size + 1; j++) {
    // size 日ぶんが「月内・同じ週・自動の出勤」で揃っているか
    let ok = true;
    for (let k = j; k < j + size; k++) {
      if (!state.dayIn[k] || state.wkKey[k] !== weekKey || state.plan[i][k] !== ST_WORK) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    let s = 0;
    for (let k = j; k < j + size; k++) s += offScore_(state, i, k);

    // 前後の休みと繋がって連休が長くなりすぎるなら減点
    const offRun = size + offRunBefore_(state, i, j) + offRunAfter_(state, i, j + size - 1);
    if (offRun > state.settings.maxOffRun) s -= 4 * (offRun - state.settings.maxOffRun);

    if (s > bestScore) { bestScore = s; best = j; }
  }

  if (best === 0) return false;
  for (let k = best; k < best + size; k++) {
    state.plan[i][k] = ST_OFF;
    covAdd_(state, i, k, -1);
  }
  return true;
}

/** 単発の休みを1つ置く。移植元: PlaceOffSingle */
function placeOffSingle_(state, i, weekKey) {
  let best = 0;
  let bestScore = ENGINE_LIMIT.SCORE_INF;

  for (let j = 1; j <= state.nD; j++) {
    if (!state.dayIn[j] || state.wkKey[j] !== weekKey || state.plan[i][j] !== ST_WORK) continue;
    const sc = offScore_(state, i, j) + adjBonus_(state, i, j);
    if (sc > bestScore) { bestScore = sc; best = j; }
  }

  if (best === 0) return false;
  state.plan[i][best] = ST_OFF;
  covAdd_(state, i, best, -1);
  return true;
}

/**
 * 1人分の連勤緩和。
 *   - 固定曜日 の人は対象外（その曜日に出るのが約束。動かすと崩れる）
 *   - 週N日 の人は同じ週の中だけで入れ替える
 *   - 連勤の中央に近い出勤日から順に候補にし、ST_OFF の日と入れ替える
 *   - 入替先は workRunIf_(i,k) <= maxRun を満たす日のうち不足が最大の日
 * 移植元: RepairRuns
 */
function repairRuns_(state, i) {
  return notImplemented_(MODULE_ENGINE, 'repairRuns_', 3); // TODO(P3)
}

/** 2つの日が同じ週か。移植元: RR_同じ週か */
function isSameWeek_(state, j, k) {
  return notImplemented_(MODULE_ENGINE, 'isSameWeek_', 3); // TODO(P3)
}

/* ---- 記号割当の内部（移植元: AP_*） ---- */

/** 既存入力の記号を個人別に数える。existing[][] だけを見る。移植元: AP_既存記号を数える */
function countExistingSymbols_(state) {
  for (let i = 1; i <= state.nP; i++) {
    if (state.skipRow[i]) continue;
    for (let j = 1; j <= state.nD; j++) {
      if (state.plan[i][j] !== ST_FWORK) continue;
      // matchWorkSym を通す。分類・集計・表示で規則を1つに保つため
      // （VBA は IsEarlySym と完全一致を混ぜていた）
      const sym = matchWorkSym(state.existing[i][j]);
      if (sym !== '') addSymCount_(state, i, sym, 1);
    }
  }
}

/** ある日の既存の記号数。移植元: AP_日別既存数 */
function countDayExisting_(state, j, kind) {
  const out = { early: 0, mid: 0, late: 0 };
  for (let i = 1; i <= state.nP; i++) {
    if (state.skipRow[i]) continue;
    if (state.kind[i] !== kind || state.plan[i][j] !== ST_FWORK) continue;
    const sym = matchWorkSym(state.existing[i][j]);
    if (sym === SYM.EARLY) out.early++;
    else if (sym === SYM.MID) out.mid++;
    else if (sym === SYM.LATE) out.late++;
  }
  return out;
}

/**
 * その記号の月合計が最少の人を選ぶ。
 * 同点のとき走査開始位置を日ごとにずらす（i = ((j + k - 1) % nP) + 1）。
 * 常に上の行を選ぶと1人に記号が偏るため。乱数ではないので再現性は保たれる。
 * 移植元: AP_最少候補
 */
function pickLeastSymbolCandidate_(state, j, kind, sym, lateOnly) {
  let best = 0;
  let bestCount = ENGINE_LIMIT.CNT_LARGE;

  for (let k = 0; k < state.nP; k++) {
    // ★ 走査の開始位置を日ごとにずらす。常に上の行から見ると1人に記号が偏る。
    //   乱数ではなく日付による巡回なので、同じ入力なら同じ結果になる
    const i = ((j + k - 1) % state.nP) + 1;

    if (state.skipRow[i]) continue;
    if (state.kind[i] !== kind) continue;
    if (state.plan[i][j] !== ST_WORK) continue;
    if (state.symbol[i][j] !== '') continue;
    if (lateOnly && !state.canLate[i]) continue;

    const c = symCount_(state, i, sym);
    if (c < bestCount) { bestCount = c; best = i; }
  }
  return best;
}

/** 記号を1つ置き、カウンタを更新する。移植元: AP_記号を置く */
function putSymbol_(state, i, j, sym) {
  state.symbol[i][j] = sym;
  addSymCount_(state, i, sym, 1);
}

/**
 * その日の遅番目標人数。
 *   lateBusy > 0 && docCount[j] >= DOC_BUSY_N なら lateBusy、他は lateMin
 * 移植元: AP_遅番目標
 */
function lateTarget_(state, j) {
  if (state.settings.lateBusy > 0 && state.dayDoc[j] >= DOC_BUSY_N) {
    return state.settings.lateBusy;
  }
  return state.settings.lateMin;
}

/** 薬剤師の記号: ○ を earlyN 人まで → ▲ を lateTarget まで → 残りは ● ▲ 交互。移植元: AP_薬剤師の記号 */
function assignPharmSymbols_(state, j) {
  const day = countDayExisting_(state, j, KIND.PHARM);
  let dayMid = day.mid;
  let dayLate = day.late;

  // 1. 早番を earlyN 人まで
  let needEarly = state.settings.earlyN - day.early;
  while (needEarly > 0) {
    const bi = pickLeastSymbolCandidate_(state, j, KIND.PHARM, SYM.EARLY, false);
    if (bi === 0) break;
    putSymbol_(state, bi, j, SYM.EARLY);
    needEarly--;
  }

  // 2. 遅番を目標人数まで（遅番可の人のみ）
  let needLate = lateTarget_(state, j) - dayLate;
  while (needLate > 0) {
    const bi = pickLeastSymbolCandidate_(state, j, KIND.PHARM, SYM.LATE, true);
    if (bi === 0) break;
    putSymbol_(state, bi, j, SYM.LATE);
    dayLate++;
    needLate--;
  }

  // 3. 残りは ● と ▲ が同数に近づくよう交互に
  //    ★ ここも lateOnly=true。遅番不可の人は ● も付かず、
  //      assignRestAsEarly_ で ○ に回る（仕様書 §4.4 の「残り」）
  for (;;) {
    const sym = (dayMid <= dayLate) ? SYM.MID : SYM.LATE;
    const bi = pickLeastSymbolCandidate_(state, j, KIND.PHARM, sym, true);
    if (bi === 0) break;
    putSymbol_(state, bi, j, sym);
    if (sym === SYM.MID) dayMid++;
    else dayLate++;
  }
}

/** 事務員の記号: ○ を clerkEarlyN 人まで → 以降は gSym。移植元: AP_事務員の記号 */
function assignClerkSymbols_(state, j) {
  const day = countDayExisting_(state, j, KIND.CLERK);
  let dayEarly = day.early;

  for (;;) {
    const sym = (dayEarly < state.settings.clerkEarlyN) ? SYM.EARLY : state.settings.gSym;
    const bi = pickLeastSymbolCandidate_(state, j, KIND.CLERK, sym, false);
    if (bi === 0) break;
    putSymbol_(state, bi, j, sym);
    if (sym === SYM.EARLY) dayEarly++;
  }
}

/** ここまでで記号が付かなかった出勤は ○ にする。移植元: AP_残りは早番 */
function assignRestAsEarly_(state, j) {
  for (let i = 1; i <= state.nP; i++) {
    if (state.skipRow[i]) continue;
    if (state.plan[i][j] === ST_WORK && state.symbol[i][j] === '') {
      putSymbol_(state, i, j, SYM.EARLY);
    }
  }
}

/* ================================================================
 *  工程14 CoverBalance — 日別の過不足を均す
 *  移植元: CoverBalance / CB_*
 * ================================================================ */

/**
 * 評価 score = Σ max(0, required[j] - cov[j])^2（小さいほど良い。過剰は0扱い）。
 * 手番: cbMoveOne_ → 届かなければ cbMoveTwo_ → どちらも無ければ終了。
 * 上限: ENGINE_LIMIT.CB_MAX_PASS。
 *
 * 【落とし穴】連勤/連休の判定は「交換した後の盤面」で行う（v9.6.0 の修正）。
 * 交換前に見ると、抜く日が入れる日の隣にあるとき、まだ出勤のままの抜く日を
 * 連勤に数えて、実際には収まる交換まで弾いてしまう。
 * 実装は「一旦入れ替えて測り、必ず戻す」。例外時も必ず戻すこと。
 */
function coverBalance_(state) {
  return notImplemented_(MODULE_ENGINE, 'coverBalance_', 3); // TODO(P3)
}

/**
 * 1手も動かないときの切り分けに使う診断文字列。§7.1 のとおり必ず移植する。
 * 形式: shortDays=..; movable=..; canWork=..; canRest=..; rawPairs=..; pairs=..; blkRun=..; blkOff=..
 * 移植元: CB_診断
 */
function cbDiagnose_(state) {
  return notImplemented_(MODULE_ENGINE, 'cbDiagnose_', 3); // TODO(P3)
}

/** 交換後の盤面で連勤上限を超えるか。移植元: CB_連勤で消えたか */
function cbRunVanished_(state, i, jTo, jFrom) {
  return notImplemented_(MODULE_ENGINE, 'cbRunVanished_', 3); // TODO(P3)
}

/** 評価値。移植元: CB_評価 */
function cbScore_(state) {
  return notImplemented_(MODULE_ENGINE, 'cbScore_', 3); // TODO(P3)
}

/**
 * 1名を移す。1手あたりの評価値は総当たりせず score - (2d - 1) で確定できる
 * （d = 入れる日の不足）。cbCanLeave_ の条件を緩めるときはこの式も見直すこと。
 * 移植元: CB_1名移す
 */
function cbMoveOne_(state) {
  return notImplemented_(MODULE_ENGINE, 'cbMoveOne_', 3); // TODO(P3)
}

/** 対象者か: 薬剤師 かつ 手動でない かつ 固定曜日でない かつ 休業でない。移植元: CB_対象者か */
function cbIsTarget_(state, i) {
  return notImplemented_(MODULE_ENGINE, 'cbIsTarget_', 3); // TODO(P3)
}

/**
 * その日に入れられるか（ST_OFF かつ その日が不足）。
 * 希望休・有休（ST_FOFF）は絶対に触らない。移植元: CB_入れられるか
 */
function cbCanInsert_(state, i, j) {
  return notImplemented_(MODULE_ENGINE, 'cbCanInsert_', 3); // TODO(P3)
}

/** その日を休みにできるか。移植元: CB_休みにできるか */
function cbCanRest_(state, i, j) {
  return notImplemented_(MODULE_ENGINE, 'cbCanRest_', 3); // TODO(P3)
}

/** 抜けるか（ST_WORK かつ 抜いてもその日が必要数を保てる）。移植元: CB_抜けるか */
function cbCanLeave_(state, i, j, jTo) {
  return notImplemented_(MODULE_ENGINE, 'cbCanLeave_', 3); // TODO(P3)
}

/** 連勤上限 = maxRun + runBonus（不足を埋めるときだけ上乗せを許す）。移植元: CB_連勤上限 */
function cbRunLimit_(state) {
  return notImplemented_(MODULE_ENGINE, 'cbRunLimit_', 3); // TODO(P3)
}

/** 交換できるか（週N日 の人は同じ週内に限る）。移植元: CB_交換できるか */
function cbCanSwap_(state, i, jTo, jFrom) {
  return notImplemented_(MODULE_ENGINE, 'cbCanSwap_', 3); // TODO(P3)
}

/** 抜ける日を選ぶ。移植元: CB_抜ける日 */
function cbPickLeaveDay_(state, i, jTo) {
  return notImplemented_(MODULE_ENGINE, 'cbPickLeaveDay_', 3); // TODO(P3)
}

/**
 * 2名の玉突き: A が不足日 D に入り中継日 X を手放す → B が X を引き受け
 * 余裕のある Y を手放す。D は +1、X は差し引き 0、Y は -1。
 * 誰の月間休日数も変わらない。
 * 打ち切りは ENGINE_LIMIT.CB_CHAIN_MAX_PASS（VBA 版に無い GAS 独自の制限。
 * 500 巡すべてが玉突きに落ちると 60 億ステップになるため。README に明記済み）。
 * 移植元: CB_2名移す
 */
function cbMoveTwo_(state) {
  return notImplemented_(MODULE_ENGINE, 'cbMoveTwo_', 3); // TODO(P3)
}

/** 不足日か。移植元: CB_不足日か */
function cbIsShortDay_(state, j) {
  return notImplemented_(MODULE_ENGINE, 'cbIsShortDay_', 3); // TODO(P3)
}

/** 中継日か。移植元: CB_中継日か */
function cbIsRelayDay_(state, i, jTo, jX) {
  return notImplemented_(MODULE_ENGINE, 'cbIsRelayDay_', 3); // TODO(P3)
}

/** 引き受けられるか。移植元: CB_引き受けられるか */
function cbCanAccept_(state, i, j) {
  return notImplemented_(MODULE_ENGINE, 'cbCanAccept_', 3); // TODO(P3)
}

/** 玉突きを実際に打つ。移植元: CB_玉突きを打つ */
function cbApplyChain_(state, a, d, x, b, y) {
  return notImplemented_(MODULE_ENGINE, 'cbApplyChain_', 3); // TODO(P3)
}

/* ================================================================
 *  工程15 FiveBalance — 混雑日（医師 DOC_BUSY_N 名）の出勤回数を個人間で均す
 *  移植元: FiveBalance / FB_*
 * ================================================================ */

/**
 * 対象者は 通常 ルールの薬剤師のみ（固定曜日・週N日は別ルールで決まる）。
 * 手番の優先順: fbSwapSameDay_ → fbLiftToBusy_ → fbDropFromBusy_。
 * 打ち切り ENGINE_LIMIT.FB_MAX_PASS。差が1以下になったら終了。
 *
 * 【落とし穴】ここでの連勤上限は maxRun（上乗せ前）。
 * 上乗せは不足日を埋めるための例外であって、個人差を均すために使うものではない。
 */
function fiveBalance_(state) {
  return notImplemented_(MODULE_ENGINE, 'fiveBalance_', 3); // TODO(P3)
}

/** 混雑日出勤の最多・最少の人を返す。移植元: FB_最多最少 */
function fbMaxMin_(state) {
  return notImplemented_(MODULE_ENGINE, 'fbMaxMin_', 3); // TODO(P3)
}

/** 対象者か（通常ルールの薬剤師のみ）。移植元: FB_対象者か */
function fbIsTarget_(state, i) {
  return notImplemented_(MODULE_ENGINE, 'fbIsTarget_', 3); // TODO(P3)
}

/** 差が2以上ある全ての組を差の大きい順に試す（v9.13.0）。移植元: FB_どれかの組で交換 */
function fbSwapAnyPair_(state) {
  return notImplemented_(MODULE_ENGINE, 'fbSwapAnyPair_', 3); // TODO(P3)
}

/** 指定の差の組で交換を試す。移植元: FB_この差の組で交換 */
function fbSwapPairWithDiff_(state, diff) {
  return notImplemented_(MODULE_ENGINE, 'fbSwapPairWithDiff_', 3); // TODO(P3)
}

/** 診断文字列。§7.1 のとおり必ず移植する。移植元: FB_診断 */
function fbDiagnose_(state) {
  return notImplemented_(MODULE_ENGINE, 'fbDiagnose_', 3); // TODO(P3)
}

/** 差が2以上の組の数。移植元: FB_差2以上の組数 */
function fbCountPairsDiff2_(state) {
  return notImplemented_(MODULE_ENGINE, 'fbCountPairsDiff2_', 3); // TODO(P3)
}

/** 交換後の盤面で連勤上限を超えるか。移植元: FB_連勤で消えたか */
function fbRunVanished_(state, hi, lo, jBusy, jFree) {
  return notImplemented_(MODULE_ENGINE, 'fbRunVanished_', 3); // TODO(P3)
}

/** 混雑日へ乗せる（余裕のある非混雑日と入れ替える）。移植元: FB_混雑日へ乗せる */
function fbLiftToBusy_(state, i) {
  return notImplemented_(MODULE_ENGINE, 'fbLiftToBusy_', 3); // TODO(P3)
}

/** 混雑日から降ろす（その日が必要数を保てるときだけ）。移植元: FB_混雑日から降ろす */
function fbDropFromBusy_(state, i) {
  return notImplemented_(MODULE_ENGINE, 'fbDropFromBusy_', 3); // TODO(P3)
}

/** 余裕のある出勤日を1つ返す。移植元: FB_余裕のある出勤日 */
function fbSpareWorkDay_(state, i, exceptJ) {
  return notImplemented_(MODULE_ENGINE, 'fbSpareWorkDay_', 3); // TODO(P3)
}

/**
 * 同日で交換 — 混雑日で多い人↔少ない人を交換し、非混雑日で逆向きに戻す。
 * 日別の人数も休日数も変わらず、混雑日の出勤回数だけが動く。
 * 移植元: FB_同日で交換
 */
function fbSwapSameDay_(state, hi, lo) {
  return notImplemented_(MODULE_ENGINE, 'fbSwapSameDay_', 3); // TODO(P3)
}

/** 渡せる混雑日か。移植元: FB_渡せる混雑日か */
function fbCanGiveBusyDay_(state, hi, lo, j) {
  return notImplemented_(MODULE_ENGINE, 'fbCanGiveBusyDay_', 3); // TODO(P3)
}

/** 戻せる非混雑日か。移植元: FB_戻せる非混雑日か */
function fbCanReturnNonBusyDay_(state, hi, lo, j) {
  return notImplemented_(MODULE_ENGINE, 'fbCanReturnNonBusyDay_', 3); // TODO(P3)
}

/** 2人で入替できるか。移植元: FB_2人で入替できるか */
function fbCanSwapTwo_(state, hi, lo, jBusy, jFree) {
  return notImplemented_(MODULE_ENGINE, 'fbCanSwapTwo_', 3); // TODO(P3)
}

/** 2人の入替を打つ。移植元: FB_2人の入替を打つ */
function fbApplySwapTwo_(state, hi, lo, jBusy, jFree) {
  return notImplemented_(MODULE_ENGINE, 'fbApplySwapTwo_', 3); // TODO(P3)
}

/* ================================================================
 *  工程17 SymbolBalance
 * ================================================================ */

/**
 * 同じ日に出勤している2人の間で記号を交換し、○●▲ 各々の個人差を2以内に収める。
 * 最大 ENGINE_LIMIT.SYMBOL_MAX_PASS 巡。手動ルールは対象外。
 * ▲ を渡す相手は canLate の人に限る。
 * 移植元: SymbolBalance
 */
function symbolBalance_(state) {
  return notImplemented_(MODULE_ENGINE, 'symbolBalance_', 3); // TODO(P3)
}

/* ================================================================
 *  計測ヘルパー（移植元: ShiftAutoLog.bas の純粋関数部）
 *  ここも SpreadsheetApp を呼ばない。
 * ================================================================ */

/**
 * 【この節の try/catch について】
 *   ここから下の計測ヘルパーは、1回の実行で数百万回呼ばれる（仕様書 §8.2）。
 *   VBA 版は全関数に On Error を置いていたが、JS では配列の添字操作しか
 *   していないため例外は起きない。起きるとすれば呼び出し側のバグで、
 *   握り潰すと原因が消える。**入口の runEngine だけで捕える。**
 */

/** 出勤の状態か（自動・既存入力を問わない） */
function isWorkState_(v) {
  return v === ST_WORK || v === ST_FWORK;
}

/** 休みの状態か（自動・既存入力を問わない） */
function isOffState_(v) {
  return v === ST_OFF || v === ST_FOFF;
}

/** 個人 i の記号 sym の月合計。移植元: SymCnt */
function symCount_(state, i, sym) {
  if (sym === SYM.EARLY) return state.cntE[i];
  if (sym === SYM.MID) return state.cntM[i];
  if (sym === SYM.LATE) return state.cntL[i];
  return 0;
}

/** 記号カウンタを d だけ増減。移植元: AddCnt */
function addSymCount_(state, i, sym, d) {
  if (sym === SYM.EARLY) state.cntE[i] += d;
  else if (sym === SYM.MID) state.cntM[i] += d;
  else if (sym === SYM.LATE) state.cntL[i] += d;
}

/**
 * j を含む連勤の長さ。左右の伸びも返す。移植元: RunLenAt
 * VBA は lft / rgt を ByRef で返していたので、こちらはオブジェクトで返す。
 * @return {{len:number, lft:number, rgt:number}}
 */
function runLenAt_(state, i, j) {
  const plan = state.plan[i];
  let a = j;
  let b = j;
  while (a > 1 && isWorkState_(plan[a - 1])) a--;
  while (b < state.nD && isWorkState_(plan[b + 1])) b++;
  return { len: b - a + 1, lft: j - a, rgt: b - j };
}

/**
 * k を出勤にしたときの連勤長。移植元: WorkRunIf
 * 【注意】VBA と同じく k 自身の状態は見ない。
 * 「k を出勤にしたら」の仮定なので、前後だけを数えて +1 する形になっている。
 */
function workRunIf_(state, i, k) {
  const plan = state.plan[i];
  let a = k;
  let b = k;
  while (a > 1 && isWorkState_(plan[a - 1])) a--;
  while (b < state.nD && isWorkState_(plan[b + 1])) b++;
  return b - a + 1;
}

/** j を休みにしたときの連休長。移植元: OffRunIf */
function offRunIf_(state, i, j) {
  return 1 + offRunBefore_(state, i, j) + offRunAfter_(state, i, j);
}

/** j の直前に続く休みの数。移植元: OffRunBefore */
function offRunBefore_(state, i, j) {
  const plan = state.plan[i];
  let n = 0;
  let a = j - 1;
  while (a >= 1 && isOffState_(plan[a])) { n++; a--; }
  return n;
}

/** j の直後に続く休みの数。移植元: OffRunAfter */
function offRunAfter_(state, i, j) {
  const plan = state.plan[i];
  let n = 0;
  let b = j + 1;
  while (b <= state.nD && isOffState_(plan[b])) { n++; b++; }
  return n;
}

/** 個人 i の混雑日出勤回数。移植元: FiveCnt */
function fiveCnt_(state, i) {
  let n = 0;
  for (let j = 1; j <= state.nD; j++) {
    if (state.dayIn[j] && state.dayDoc[j] === DOC_BUSY_N && isWorkState_(state.plan[i][j])) n++;
  }
  return n;
}

/**
 * 対象者全員の混雑日出勤回数の平均。移植元: FiveAvg
 * 対象は「skipRow でない薬剤師で休業でない人」。ルールは問わない
 * （FiveBalance の対象者判定とは条件が違う。VBA のとおり）。
 */
function fiveAvg_(state) {
  let total = 0;
  let count = 0;
  for (let i = 1; i <= state.nP; i++) {
    if (state.skipRow[i]) continue;
    if (state.kind[i] === KIND.PHARM && !state.leave[i]) {
      total += fiveCnt_(state, i);
      count++;
    }
  }
  return count > 0 ? total / count : 0;
}

/** 個人 i の最大連勤。移植元: MaxRun */
function maxRunOf_(state, i) {
  let best = 0;
  let cur = 0;
  for (let j = 1; j <= state.nD; j++) {
    if (isWorkState_(state.plan[i][j])) {
      cur++;
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
  }
  return best;
}

/** 個人 i の最大連休。移植元: MaxOffRun */
function maxOffRunOf_(state, i) {
  let best = 0;
  let cur = 0;
  for (let j = 1; j <= state.nD; j++) {
    if (isOffState_(state.plan[i][j])) {
      cur++;
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
  }
  return best;
}

/**
 * 日別出勤数カウンタを d だけ増減。移植元: CovAdd
 * 薬剤師は cov、事務員は covG。それ以外の区分はどちらにも入らない
 * （区分の打ち間違いが人数計算に影響しない代わりに、静かに無視される）。
 */
function covAdd_(state, i, j, d) {
  if (state.skipRow[i]) return;
  if (state.kind[i] === KIND.PHARM) state.cov[j] += d;
  else if (state.kind[i] === KIND.CLERK) state.covG[j] += d;
}

/**
 * 固定曜日の文字列（例 "月火金土"）を boolean[8] に展開する。移植元: ParseWD
 * 添字は 1=日 .. 7=土（VBA の Weekday と同じ）。0 番は使わない。
 * @param {string} text
 * @return {boolean[]}
 */
function parseFixedDow(text) {
  const WDS = '日月火水木金土';
  const out = [false, false, false, false, false, false, false, false];
  const s = String(text == null ? '' : text).trim();
  for (let k = 0; k < s.length; k++) {
    const w = WDS.indexOf(s.charAt(k)) + 1;   // 見つからなければ 0
    if (w >= 1 && w <= 7) out[w] = true;
  }
  return out;
}

/**
 * セルの文字列が出勤記号なら、正規化した記号を返す。出勤でなければ ''。
 *
 * ○ と ◯ はどちらも ○ に正規化する（入力揺れ。移植元: IsEarlySym）。
 * WORK_SYM_PREFIX_MATCH が true のときは先頭一致で見るので、
 * 「▲医A」のような記号＋氏名の複合テキストも ▲ として拾う。
 *
 * 既存分類（ST_FWORK / ST_FOFF）とシート上の集計は、必ず**この関数と同じ規則**で
 * 判定すること。片方だけ変えると、表に出ている人数と中で数えている人数がずれる。
 *
 * @param {string} value セルの文字列
 * @return {string} '○' | '●' | '▲' | ''
 */
function matchWorkSym(value) {
  const v = String(value || '').trim();
  if (v === '') return '';

  const table = [
    { sym: SYM.EARLY, canonical: SYM.EARLY },
    { sym: SYM.EARLY_ALT, canonical: SYM.EARLY },   // 全角の別字体も早番
    { sym: SYM.MID, canonical: SYM.MID },
    { sym: SYM.LATE, canonical: SYM.LATE },
  ];

  for (let i = 0; i < table.length; i++) {
    const hit = WORK_SYM_PREFIX_MATCH
      ? v.indexOf(table[i].sym) === 0
      : v === table[i].sym;
    if (hit) return table[i].canonical;
  }
  return '';
}

/**
 * シフト表の入力欄に入る記号か（出勤記号 or 休み記号）。
 * 医師名や備考の文字列と区別するために使う。
 *
 * 【なぜ要るか】医師数(診) の数式は医師名欄を COUNTA で数えているので、
 * 医師名欄にシフト記号が入ると医師数が水増しされ、必要数がまるごと狂う。
 * 記号を入力欄の外へ出さないことは、表の正しさに直結する。
 *
 * @param {string} value セルの文字列
 * @return {boolean}
 */
function isShiftSymbol(value, extraSymbols) {
  const v = String(value || '').trim();
  if (v === '') return false;
  if (matchWorkSym(v) !== '') return true;
  if (SYM.OFF_ALL.indexOf(v) >= 0) return true;
  // マスタで足された記号（利用者が「シフトパターン」に追加したもの）
  return !!(extraSymbols && extraSymbols.indexOf(v) >= 0);
}

/**
 * 公休ノルマに数えない休みか。
 * 【必ず部分一致】設定 L11 に「有休」とだけ書けば「有休※」も外れる、という約束。
 * 集計列 AH/AI の振り分け（Setup.gs）もこの関数と同じ規則にすること（§5.4）。
 * 移植元: IsPaidOff
 * @param {string} value セルの文字列
 * @param {string} paidSyms 設定 L11 の値（カンマ区切り）
 * @return {boolean}
 */
function isPaidOff(value, paidSyms) {
  const v = String(value || '').trim();
  if (v === '') return false;
  // VBA は Replace(mPaidSyms, "、", ",") してから split している。
  // 全角カンマで区切られた設定を取りこぼさないため、ここも合わせる
  return String(paidSyms || SETTING_DEFAULT.paidSyms.value)
    .split('、').join(',')
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s !== ''; })
    .some(function (token) { return v.indexOf(token) >= 0; });
}
