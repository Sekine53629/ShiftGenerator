# Auto Shift Generator — GAS 移植仕様書

VBA 版 `GitHub/VBA/Auto_Shift_Generator`（11 モジュール / 約 8,900 行）を
Google Apps Script + Google スプレッドシートへ移植するための仕様。

- **作成日**: 2026-09-02
- **移植元の版**: ShiftCommon v3.2 / ShiftAuto v9.7.1 / ShiftAutoPlace v9.13.0 /
  ShiftAutoLog v9.5.0 / ShiftClick v9.4 / ShiftSetup v2.9 / ShiftSchema v1.5 /
  ShiftExport v1.1 / ShiftSurvey v2.2 / Sheet1 v2.3
- **想定マウント**: `GitHub/GAS/AutoShiftGenerator`（新規・コンテナバインドスクリプト）
- **確定済みの方針**: クリック入力パレットは **サイドバー（HtmlService）** で代替する

> **⚠ 2026-09-03 に §6 の方針が変わりました。**
> クリック入力は **サイドバーではなく Web アプリ**（`WebApp.gs` / `WebAppView.html`）
> になりました。経緯と割り切りは [`WEBAPP-DESIGN.md`](WEBAPP-DESIGN.md) を読んでください。
> §6.3（押せる場所の制約）・§6.4（医師名スタンプ）・§6.5（値と太字だけ書く）・
> §6.6（手動変更のログ）は Web アプリでもそのまま要件として効きます。
> 実物のシフト表と本仕様書の差分は [`REAL-SHEET-FINDINGS.md`](REAL-SHEET-FINDINGS.md) に。

---

## 0. この文書の使い方

新セッションでは、この仕様を読んでから実装に入ること。
**VBA 版のソースは読み替えの正典**なので、判断に迷ったら
`GitHub/VBA/Auto_Shift_Generator/src/*.bas` を読み取り専用で参照する
（Tier 1 のルール上、VBA 側のファイルは変更しない）。

移植の難所は 3 つに集約される。

1. **イベントモデル** — Sheets に `SelectionChange` / `BeforeDoubleClick` /
   `BeforeRightClick` は無い。クリック入力はサイドバーに置き換える（§6）
2. **数式の非互換** — `MATCH` に配列を渡す用法が Sheets では効かない（§5.3）
3. **実行時間 6 分の壁** — 均等化ループの計算量に上限を入れる（§8）

---

## 1. スコープ

### 移植する

| VBA 機能 | 移植方針 |
|---|---|
| シフトの自動作成（配置アルゴリズム一式） | **そのまま移植。ロジックは1文字も変えない**（§4） |
| 設定チェック / 事前診断 | 移植。出力先はダイアログ or サイドバー |
| 変更ログ・セッション単位の巻き戻し | 移植。ログはシートのまま |
| シートの初期設定（数式・名前付き範囲） | 移植。数式は Sheets 方言へ書き換え（§5） |
| 不足シートの生成 | 移植 |
| 祝日マスタの取込 | Power Query → `UrlFetchApp`（§7.2） |
| 印刷用の出力（PDF） | Drive のエクスポート URL 経由（§7.3） |
| シート構造の調査 | 移植（優先度は最後） |
| クリック／スタンプ入力 | **サイドバーへ再設計**（§6） |

### 移植しない / 落ちる機能

| 項目 | 理由 | 代替 |
|---|---|---|
| シート上のパレット行（★マーカー行・本体行・ラベル行の3行） | サイドバーが役目を引き継ぐ | サイドバーのボタン。シート側の3行は**生成しない** |
| ダブルクリックで記号を順送り | Sheets にイベントが無い | サイドバーの「次へ」ボタン |
| 右クリックで1つ戻す | 同上 | サイドバーの「前へ」ボタン |
| 和暦の表示形式 `[$-ja-JP]ge"." m"月"` | Sheets は和暦のカスタム書式を持たない | 西暦表示（`yyyy年m月`）。和暦が要るなら文字列を数式で組む |
| スピンボタン（Forms コントロール）での月送り | Sheets にフォームコントロールが無い | サイドバーの「前月／翌月」ボタン、または図形にスクリプト割当 |
| Excel 形式（.xlsx）での出力 | 優先度低。PDF で足りる | 必要なら Drive のエクスポート URL で `xlsx` を指定 |
| `Erl`（エラー行番号） | JS に相当物が無い | `error.stack` を記録する |

---

## 2. プロジェクト構成

**コンテナバインドスクリプト**であること（`onOpen` / サイドバー /
`getActiveRange()` はバインドでないと動かない）。

```
AutoShiftGenerator/
├── CLAUDE.md              ← Tier 3
├── README.md
├── appsscript.json
├── Config.gs              ← 定数一元管理（VBA: ShiftCommon の定数部）
├── Layout.gs              ← シート上の位置解決（VBA: ShiftCommon の関数部）
├── Log.gs                 ← エラー/成功ログ（VBA: ErrorLogger）
├── Menu.gs                ← onOpen とメニュー
├── Engine.gs              ← ★配置エンジン（SpreadsheetApp を一切呼ばない）
├── ShiftAuto.gs           ← 入口・シート読み書き・Engine の呼び出し
├── Report.gs              ← 結果レポートの文字列組み立て
├── SettingsCheck.gs       ← 設定チェック
├── ChangeLog.gs           ← 変更ログ・巻き戻し・白紙化
├── Schema.gs              ← 不足シート生成
├── Holidays.gs            ← 祝日マスタ取込
├── Setup.gs               ← 初期設定（数式・名前付き範囲）
├── Export.gs              ← PDF 出力
├── Survey.gs              ← シート構造調査
├── Sidebar.gs             ← サイドバーのサーバ側 API
└── Sidebar.html           ← サイドバーの UI
```

### モジュール対応表

| VBA | GAS | 備考 |
|---|---|---|
| `ShiftCommon` (951行) | `Config.gs` + `Layout.gs` | パレット関連（IDX_*, IsDoctorStamp, PaletteLabel, LastDoctorIndex, PaletteRange）は**丸ごと不要**になる |
| `ErrorLogger` (344行) | `Log.gs` | 出力先を CSV ファイル → console + ログシートへ |
| `AutoShiftGenerator` (701行) | `ShiftAuto.gs` + `Engine.gs` | 前半（準備・読込）は ShiftAuto、素案づくり以降は Engine |
| `ShiftAutoPlace` (2044行) | `Engine.gs` + `Report.gs` | 配置・均等化は Engine、AP_レポート* は Report |
| `ShiftAutoLog` (792行) | `ChangeLog.gs` + `SettingsCheck.gs` + `Engine.gs`（計測ヘルパ） | |
| `ShiftClick` (958行) + `Sheet1` (193行) | `Sidebar.gs` + `Sidebar.html` | **全面再設計**。移植ではない |
| `ShiftSchema` (746行) | `Schema.gs` + `Holidays.gs` | |
| `ShiftSetup` (1234行) | `Setup.gs` | パレット生成の約 250 行が不要になる |
| `ShiftExport` (327行) | `Export.gs` | |
| `ShiftSurvey` (620行) | `Survey.gs` | |

### appsscript.json

```json
{
  "timeZone": "Asia/Tokyo",
  "runtimeVersion": "V8",
  "exceptionLogging": "STACKDRIVER",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets.currentonly",
    "https://www.googleapis.com/auth/script.container.ui",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/drive.readonly"
  ]
}
```

> `script.external_request` は祝日 CSV の取得に、`drive.readonly` は PDF
> エクスポート URL の取得に要る。PDF 出力を後回しにするなら最初は外してよい。

---

## 3. シートのスキーマ

VBA 版の実シート構成をそのまま踏襲する。**パレットの3行だけが消える**。

### 3.1 シフトシート（`シフト`）

```
                              VBA 版          GAS 版
 1行  ★マーカー行            あり            なし
 2行  パレット本体行          あり            なし
 3行  パレットラベル行        あり            なし
 4行  年月・タイトル行        A=年月 / D=タイトル / I=祝日サマリー   同左
 5行  日付行（開始日の数式）  ← 基準セル      同左
 6行  曜日行  =TEXT(B5,"aaa")                 同左
 7-11行 医師名欄（5行）                       同左
12行  空行
13行  日付の再掲
14行  スタッフ入力の開始
 …
29行  備考
31行  医師数(診)   = 備考 + NOTE_TO_DOC(2)
32行  薬剤師出勤数
33行  過不足
```

- 列: `B`〜`AF`（日付・シフト）、`AG` 年月シリアル、`AH`〜`AM` 集計列
- パレット3行を作らないので、**行番号は上に3つずれてよい**。ただし位置は
  すべて「B列の日付数式」から相対で解決するので、ずれてもコードは動く。
  既存の Excel ブックから移行する場合は3行残っていても害はない（読まないだけ）。

### 3.2 位置解決のルール（`Layout.gs`）

VBA の解決ロジックをそのまま持ってくる。**1回の実行で1度だけ解決し、
オブジェクトにまとめて持ち回る**こと（VBA のように毎回呼び直さない）。

```javascript
// Layout.resolve(sheet) が返す形
{
  dateRow,        // B列で最初の「数式かつ日付」の行
  repeatDateRow,  // 同 2個目（再掲日付行）
  headerRow,      // dateRow - 1
  weekRow,        // dateRow + 1
  doctorTop, doctorBottom,  // 医師名欄（DOC_BLOCK_ROWS = 5）
  noteRow,        // A列「備考」の前方一致
  docRow,         // noteRow + NOTE_TO_DOC(2)。無ければ A列「医師数」
  shortageRow,    // A列「過不足」。無ければ docRow + 2
  gridTop,        // repeatDateRow + DATE_REPEAT_GAP(1)
  gridBottom,     // docRow - DOC_GAP(4)
  firstCol, lastCol  // B..AF
}
```

実装の要点:

- 「数式かつ日付」の判定は `getFormulas()` と `getValues()` を **B列 1〜200 行を
  1回ずつ**読んで突き合わせる（`hasFormula` に相当する単発 API は無い）。
  `formula !== ''` かつ `value instanceof Date`。
- A列ラベルの前方一致検索（`LabelRow`）も A列を1回読んで JS 側で走査する。
- 名前付き範囲は `spreadsheet.getRangeByName(name)` で取れる。VBA と同じく
  **名前付き範囲を優先し、無ければ計算で解決する**フォールバックを残す。
- `ShiftRangeDrift`（入力欄下端のずれ検出）も移植する。設定チェックが使う。

### 3.3 自動作成設定シート（`自動作成設定`）

VBA 版と完全に同一。列・行の定数は `Config.gs` にそのまま移す。

**メンバー表（4行目=見出し / 5行目〜）**

| 列 | 定数 | 内容 |
|---|---|---|
| A | `CFG_COL_NAME` | 氏名（シフト表A列との照合キー） |
| B | `CFG_COL_KIND` | 区分 `薬剤師` / `事務員` |
| C | `CFG_COL_CLOSED` | 休業（`○` で当月スキップ） |
| D | `CFG_COL_RULE` | 勤務ルール `通常` / `固定曜日` / `週N日` / `手動` |
| E | `CFG_COL_FIXDOW` | 固定曜日（例 `月火金土`） |
| F | `CFG_COL_WEEKN` | 週勤務日数 |
| G | `CFG_COL_OFFDAY` | 月間休日数（空欄=土日祝と同数。**`通常` のときだけ読む**） |
| H | `CFG_COL_LATE` | 遅番・遅半 可否（`不可` で ▲ を割り当てない） |
| I | `CFG_COL_MEMO` | 備考 |

**全体設定（K=ラベル / L=値、4行目=見出し、以降13行）**

| ラベル（前方一致で探すキー） | 既定 | 内部名 |
|---|---|---|
| 早番(○) 人数/日 | 1 | `earlyN` |
| 遅番(▲) 最低人数/日 | 3 | `lateMin` |
| 連勤の上限(日) | 3 | `maxRun` |
| 連休の上限(日) | 3 | `maxOffRun` |
| 週の基本休日数 | 2 | `weekBase` |
| 必要出勤数(医師数+n)の n | 1 | `reqPlus` |
| ノルマ外の休み記号(カンマ区切り) | `有休,夏休` | `paidSyms` |
| 週の定義(固定) | 日曜始まり・土曜終わり | （表示のみ） |
| 事務員の2人目以降の記号 | `●` | `gSym` |
| 事務員の早番(○) 人数/日 | 1 | `clerkEarlyN` |
| 混雑日_医師5名_の遅番(▲) 最低人数/日 | 0 | `lateBusy` |
| 不足を埋めるときの連勤上限の上乗せ(日) | 0 | `runBonus` |

読み取りは VBA の `CfgNum` / `CfgTxt` と同じ **K列ラベルの部分一致 → L列の値**。
見出し行から `CFG_SCAN_ROWS`(30) 行下まで走査する。
値が空欄・非数値なら既定値にフォールバックする挙動を必ず保つこと
（既存ブックには新しい設定行が無いため）。

### 3.4 祝日マスタ / 変更ログ

- `祝日マスタ`: 1行目=見出し `日付`, `名称` / 2行目〜データ
- `シフト変更ログ`: 1行目=見出し / 2行目〜
  列 1=セッション 2=日時 3=操作 4=セル 5=変更前 6=変更後
  7=取消済 8=前文字色 9=前太字 10=前塗り色

> 変更ログの見出し配列（`SC_LogHeads`）は `日時,セル,変更前,変更後,ユーザー,備考`
> だが、実際に使われる列は上の 10 列。VBA 側もここは食い違っており、
> `GetLogSheet` が 7〜10 列目を後付けしている。**GAS 版では最初から
> 10 列の見出しを書く**こと。

---

## 4. 配置エンジン（最重要・ロジックは一切変えない）

VBA 側の `mPlan` などはすべて 2 次元配列なので、**エンジンは
SpreadsheetApp に一切触らない純粋な関数として書ける**。これが移植の最大の勝ち筋。
テストが書けるようになり、6 分制限のプロファイルも取れる。

### 4.1 エンジンの境界

```javascript
// Engine.gs — SpreadsheetApp を import しない/呼ばない
function runEngine(input) { ... return output; }

// input
{
  settings: { earlyN, lateMin, maxRun, maxOffRun, weekBase, reqPlus,
              paidSyms, gSym, clerkEarlyN, lateBusy, runBonus },
  days: [ { date, inMonth, weekday /*1=日..7=土*/, isHoliday,
            docCount, required /*docCount+reqPlus*/, weekKey } ],
  members: [ { name, kind, rule, leave, canLate, quota /*-1=未指定*/,
               weekN, fixedDow /*[7]bool*/, skipRow } ],
  existing: [ [ cellText, ... ] ]   // 入力欄の生の文字列（行×日）
}

// output
{
  plan:   [[ ST_* ]],       // 行×日
  symbol: [[ "○"|"●"|"▲"|"" ]],
  counts: { cntE[], cntM[], cntL[] },
  targetOff,                // 公休ノルマ（土日祝の日数）
  unmet,                    // ノルマ未達の一覧
  diagnostics: { coverBalance: {...}, fiveBalance: {...} }
}
```

### 4.2 予定ステータス（そのまま）

| 定数 | 値 | 意味 |
|---|---|---|
| `ST_SKIP` | -1 | 月外・休業・空行・集計行 |
| `ST_NONE` | 0 | 未決定 |
| `ST_WORK` | 1 | 自動:出勤 |
| `ST_OFF` | 2 | 自動:公休 |
| `ST_FWORK` | 3 | 既存入力:出勤（`○◯●▲`） |
| `ST_FOFF` | 4 | 既存入力:休み（希休・有休・公休など） |

**不変条件**: `ST_FWORK` / `ST_FOFF` は自動処理で**絶対に書き換えない**。
入力済みのセルはすべて保持し、空白セルだけを埋めるという約束の土台。

### 4.3 工程（`シフト自動作成` の司令塔と同じ順序）

```
 0) 状態リセット
 1) 準備            シート・設定値・入力欄の解決           → ShiftAuto.gs
 2) 日情報          日付/曜日/祝日/医師数/必要数/公休ノルマ → ShiftAuto.gs
 3) メンバー読込    氏名キーでマスタ照合・不整合の検出      → ShiftAuto.gs
 4) 孤児検出        マスタにあるがシフト表に無い氏名        → ShiftAuto.gs
 5) 事前確認        不整合をまとめて提示し続行の可否を問う  → ShiftAuto.gs
─────────────── ここから下が Engine.gs ───────────────
 6) 既存分類        入力済みセルを ST_FWORK / ST_FOFF に分類
 7) ルール適用      固定曜日 / 手動=触らない / それ以外は仮で全出勤
 8) 予定出勤数      日ごとの出勤数を薬剤師(cov)と事務員(covG)で別に数える
 9) 週N日ルール     週ごとの勤務日数を指定数まで絞る
10) 週リスト        日曜起点の週キーを昇順に並べる
11) 公休ノルマ      週の基本休を置き、余剰は連休化
12) 残ノルマ配置    未達分を既存の休みに寄せて1日ずつ（誤差0厳守）
13) 連勤緩和        連勤上限超えを入替で緩和（最大3巡）
14) CoverBalance    日別の過不足を均す
15) FiveBalance     混雑日(医師5名)の出勤回数を個人間で均す
16) 記号割当        ○ → ▲ → 残りを ● ▲ で均等
17) SymbolBalance   ○●▲ の個人差を均す
─────────────── ここから下が ShiftAuto.gs ───────────────
18) 書き込み        差分をログに残しながらシートへ
19) 休業行の塗り    休業者の行を灰色に
20) レポート        結果ダイアログ
```

### 4.4 各工程の仕様（移植時に落としてはいけない点）

#### 日情報
- 月内判定は `Month(日付) === Month(対象月)`
- 週キー `weekKey = 日付シリアル - (曜日(日=1) - 1)` → 日曜起点
- `targetOff`（公休ノルマ）= 月内の **土日 + 平日の祝日**の日数
  （祝日が土日に重なっても二重に数えない）

#### メンバー読込
- 氏名が空 or 集計行ラベル（`医師数,薬剤師出勤数,事務員出勤数,過不足,合計,
  シフトパレット,備考,医師名` の前方一致）の行は `skipRow`
- 同名重複は「先に見つかった設定が適用される」。警告を出すが処理は続ける
- 区分が `薬剤師` / `事務員` 以外 → 人数計算に計上されないので警告
- **月間休日数は `通常` ルールでしか読まない**。他ルールに入っていたら
  「設定しても読まれない項目」として実行前に一覧で出す（v9.7.0 の趣旨）

#### 既存分類
```
記号 ○ ◯ ● ▲ のいずれか → ST_FWORK
それ以外の非空文字        → ST_FOFF （希休・有休・公休など）
空白                      → ST_NONE
```
`◯`（全角の別字体）は `○` と同じ早番として扱う（`isEarlySym`）。

#### 公休ノルマ
1. 各人の残ノルマ `remOff = quota - (ノルマ対象の既存休の数)`
   - `quota` は `月間休日数`。未指定なら `targetOff`
   - 既存休のうち **`ノルマ外の休み記号` に部分一致するもの（既定 有休・夏休）は数えない**
2. 週ごとの目標休日数 `tW[w]` を組む
   - `tW = weekBase - (その週の既存休)`、その週の残り日数を超えない
   - **その週の月内日数が2日以下なら tW は最大1**（月初/月末の端週）
   - 合計が `remOff` を超えるなら後ろの週から1ずつ削る（最大100巡）
   - 足りないなら前の週から1ずつ足す（`maxOffRun` が上限。最大100巡）
3. 週ごとに **3連休 → 2連休 → 単発** の順で置く（`PlaceOffBlock` / `PlaceOffSingle`）

#### 残ノルマ配置
残った分を `OffScore + AdjBonus` が最大の出勤日へ1日ずつ。
置けなくなったら `unmet` に「あとn日 配置できず」を記録して打ち切る。

#### `OffScore(i, j)` — その日を休みにする良さ（大きいほど休み向き）
```
薬剤師:
  s += 5.0 * (cov[j] - 1 - required[j])          // 不足を日別に均す（ソフト）
  if (docCount[j] === 5) s += 3.0 * (fiveCnt(i) - fiveAvg())
事務員:
  if (covG[j] - 1 < 1) s -= 12                   // 事務員ゼロの日は強く回避
  else                 s += 4.0 * (covG[j] - 2)  // 重なる日を優先して休みに
共通:
  L = runLenAt(i, j, lft, rgt)
  if (L >= maxRun + 1) s += 8 + min(lft, rgt)
  if (土 || 日 || 祝) s += 2
```

#### `AdjBonus(i, j)` — 既存休に隣接して連休になる位置を優遇
```
total = 1 + offRunBefore + offRunAfter
2 <= total <= maxOffRun  →  +4
total > maxOffRun        →  -3 * (total - maxOffRun)
```

#### 連勤緩和（`RepairRuns`）
- **`固定曜日` の人は対象外**（その曜日に出るのが約束。動かすと崩れる）
- **`週N日` の人は同じ週の中だけで入れ替える**（週の勤務日数を保つため）
- 連勤の中央に近い出勤日から順に候補にし、`ST_OFF` の日と入れ替える
- 入替先は `WorkRunIf(i,k) <= maxRun` を満たす日のうち、
  不足が最大の日（薬剤師 `required-cov` / 事務員 `1-covG`）

#### CoverBalance（日別の過不足を均す）
```
評価  score = Σ max(0, required[j] - cov[j])^2     ← 小さいほど良い
      過剰は0扱い。不足2の日1つ(=4)より不足1の日2つ(=2)を良しとする
手番  CB_1名移す → 届かなければ CB_2名移す → どちらも無ければ終了
上限  CB_MAX_PASS = 500
```

- **対象者**: 薬剤師 かつ `手動` でない かつ `固定曜日` でない かつ 休業でない
- **入れられる日**: `ST_OFF`（自動で置いた公休）かつ その日が不足している
  → 希望休・有休（`ST_FOFF`）は絶対に触らない
- **抜ける日**: `ST_WORK` かつ **抜いてもその日が必要数を保てる**
  → `週N日` の人は同じ週内に限る
- **連勤/連休の判定は「交換した後の盤面」で行う**（v9.6.0 の修正）。
  交換前に見ると、抜く日が入れる日の隣にあるとき、まだ出勤のままの抜く日を
  連勤に数えて、実際には収まる交換まで弾いてしまう。
  → 実装は「一旦入れ替えて測り、必ず戻す」。**例外時も必ず戻すこと**
- **連勤上限は `maxRun + runBonus`**（不足を埋めるときだけ上乗せを許す）。
  連休上限は `maxOffRun`（上乗せしない）
- 1手あたりの評価値は総当たりせず `score - (2d - 1)`（d = 入れる日の不足）で
  確定できる。`CB_抜けるか` の条件を緩めるときはこの式も見直すこと
- **2人の玉突き**: `A` が不足日 D に入り中継日 X を手放す →
  `B` が X を引き受け余裕のある Y を手放す。
  D は +1、X は差し引き 0、Y は -1。**誰の月間休日数も変わらない**

#### FiveBalance（混雑日の出勤回数を均す）
- **対象者**: `通常` ルールの薬剤師のみ（固定曜日・週N日は別ルールで決まる）
- 手番の優先順:
  1. `FB_同日で交換` — 混雑日で多い人↔少ない人を交換し、非混雑日で逆向きに戻す。
     **日別の人数も休日数も変わらず、混雑日の出勤回数だけが動く**。
     差が2以上ある**全ての組**を差の大きい順に試す（v9.13.0）
  2. `FB_混雑日へ乗せる` — 余裕のある非混雑日と入れ替える
  3. `FB_混雑日から降ろす` — その日が必要数を保てるときだけ
- 打ち切り `FB_MAX_PASS = 100`、差が1以下になったら終了
- **ここでの連勤上限は `maxRun`（上乗せ前）**。上乗せは不足日を埋めるための
  例外であって、個人差を均すために使うものではない

#### 記号割当
```
薬剤師: ○ を earlyN 人まで
      → ▲ を lateTarget(j) 人まで（遅番可の人のみ）
      → 残りは ● と ▲ が同数に近づくよう交互に
事務員: ○ を clerkEarlyN 人まで → 以降は gSym（既定 ●）
残り  : ここまでで記号が付かなかった出勤（遅番不可の薬剤師など）は ○
```
- `lateTarget(j)` = `lateBusy > 0 && docCount[j] >= 5` なら `lateBusy`、他は `lateMin`
- 候補選びは「その記号の月合計が最少の人」。
  **同点のとき走査開始位置を日ごとにずらす**（`i = ((j + k - 1) % nP) + 1`）。
  常に上の行を選ぶと1人に記号が偏る。乱数ではなく日付による巡回なので、
  同じ入力なら同じ結果になる（実行を比べられる）

#### SymbolBalance
同じ日に出勤している2人の間で記号を交換し、○●▲ 各々の個人差を
**2以内**に収める。最大300巡。`手動` ルールは対象外。
▲ を渡す相手は `canLate` の人に限る。

### 4.5 結果レポート（`Report.gs`）

見出し → 個人別 → 警告 の3部構成。以下は必ず出す。

- 対象月 / 公休ノルマ / 書込セル数 / 入力範囲 / 対象者数
- 個人別: `出勤n 休n(うちノルマ外n) 連勤maxn 連休maxn 医5日n ○n ●n ▲n`
- 警告:
  - 公休ノルマ未達
  - 事務員が不在の日
  - 遅番が目標に届かない日（うち「目標-1名未満」の日）
  - **勤務ルールの検証** — 週N日/固定曜日が守られているかを
    マクロ自身の週の切り方（日曜起点）で数え直す
  - **連勤上乗せの影響** — 上乗せを使った結果、通常上限を超えた人を
    **必ず名指しで列挙**する（労務上の例外なので）
  - 必要数に届かない日 + **人日収支**
    （月の必要人日 vs 出勤人日。「配分の偏り」か「人手不足」かを判別させる）
  - 設定未登録 / マスタにあるがシフト表に無い

> レポートは長い。`SpreadsheetApp.getUi().alert()` は長文に向かないので、
> **モーダルダイアログ（HtmlService）で表示**すること。

---

## 5. 数式の移植（`Setup.gs`）

> **⚠ 2026-09-04: この節はほぼ不要になりました。**
> Web アプリを主役とし、**シートに数式を持たせない**方針に変わったためです
> （[`REQUIREMENTS.md`](REQUIREMENTS.md) §4.5 / §4.6）。集計は Web アプリが計算し、
> シートには**値として**書きます。`Setup.gs` そのものも捨てます。
>
> **消さずに残しているのは、知見のためです。**
> とくに §5.3 の「`MATCH` に配列を渡しても Sheets は配列を返さない。
> エラーにならず黙って誤った人数を返す」は、シートに数式を置く限り必ず踏む罠です。
> 将来また数式を持たせたくなった人が、同じ穴に落ちないように残します。
>
> なお §5.2 の和暦は形を変えて生きています。表示形式では作れないので、
> **別セルに数式で文字列を組む**形にしました（`title.formula`）。

### 5.1 そのまま通るもの

| VBA/Excel | Sheets |
|---|---|
| `=DATE(1900,AG4,1)` | そのまま |
| `=TEXT(B5,"aaa")` | そのまま（曜日の短縮形） |
| `=COUNTA(B7:B11)` | そのまま |
| `=COUNTIF(B14:AF14,"公休")` | そのまま |
| `LET(...)` | そのまま（Sheets も対応済み） |
| `SUMPRODUCT((B$31:AF$31=5)*((B14:AF14="○")+...))` | そのまま |
| `IFERROR(INDEX(設定!$L:$L,MATCH("必要出勤*",設定!$K:$K,0)),1)` | そのまま（ワイルドカード可） |

`.Formula2`（Excel の動的配列）は Sheets には無い。すべて `setFormula()` でよい。

### 5.2 書き換えが要るもの

**年月セルの表示形式**
```
VBA : NumberFormatLocal = "[$-ja-JP]ge""."" m""月"""   ← 和暦
GAS : setNumberFormat("yyyy\"年\"m\"月\"")             ← 西暦
```
和暦が必須なら、表示用に別セルへ文字列を組む数式を置く
（`=TEXT(A4,"yyyy")-1988 & "." & TEXT(A4,"m") & "月"` のような当て込み）か、
スクリプトで文字列を書く。**元号の切り替わりに追従できない**点は
利用者に明示すること。

**祝日サマリー（`I4`）** — VBA 版はそのまま通る。
```
=LET(d,B5:AF5,
     inM,--(MONTH(d)=MONTH(A4)),
     wk,SUMPRODUCT(inM*(WEEKDAY(d,2)>5)),
     hol,SUMPRODUCT(inM*(WEEKDAY(d,2)<6)*COUNTIF(祝日マスタ!$A:$A,d)),
     "土日公休"&wk&"回　祝日"&hol&"回　公休ノルマ"&(wk+hol)&"日")
```
この `wk+hol` は `targetOff` と必ず一致する。文言も合わせること。

### 5.3 ⚠ 非互換 — 薬剤師出勤数の数式

**これが移植で最も静かに壊れる箇所。**

VBA 版:
```excel
=SUMPRODUCT(
   (IFERROR(INDEX(自動作成設定!$B:$B, MATCH($A14:$A27, 自動作成設定!$A:$A, 0)), "")="薬剤師")
   * ((B14:B27="○")+(B14:B27="◯")+(B14:B27="▲")+(B14:B27="●")))
```

Google Sheets では **`MATCH` の第1引数に配列を渡しても配列は返らない**
（先頭要素の1件だけを見る）。エラーにならず、黙って誤った人数を返す。

**対策（推奨）— 区分の作業列を置く**

シフト表に区分の隠し列（例 `AN`）を作り、行ごとに1件ずつ引く。

```
AN14 : =IFERROR(INDEX(自動作成設定!$B:$B, MATCH($A14, 自動作成設定!$A:$A, 0)), "")
```

薬剤師出勤数はこう書ける。
```
B32 : =SUMPRODUCT(($AN$14:$AN$27="薬剤師")*((B14:B27="○")+(B14:B27="◯")+(B14:B27="▲")+(B14:B27="●")))
```

作業列は列を非表示にしておく。`Setup.gs` が入力欄の行数に合わせて
生成し、`Layout.gs` の解決対象に加えること。

> 代替として `ARRAYFORMULA(MATCH(...))` でも動くが、
> `SUMPRODUCT` の中で `ARRAYFORMULA` を入れ子にすると挙動が読みにくく、
> 行の増減で壊れやすい。作業列のほうが検証しやすい。

### 5.4 集計行・集計列

**集計行**（`docRow` から3行、B〜AF 各列）
```
医師数(診)    =COUNTA(B7:B11)                       ← 医師名欄ブロックを列ごとに
薬剤師出勤数  §5.3 の作業列方式
過不足        =B32-(B31+IFERROR(INDEX(自動作成設定!$L:$L,MATCH("必要出勤*",自動作成設定!$K:$K,0)),1))
```
A列の見出し（`医師数(診)` / `薬剤師出勤数` / `過不足`）は
**空欄のときだけ補う**。手で変えた見出しを消さないため。

**集計列**（`AH`〜`AM`、見出しは `gridTop - 1` 行）

| 列 | 見出し | 数式 |
|---|---|---|
| AH | 公休 | ノルマ対象の休み記号を `COUNTIF` の和 |
| AI | 有休 | ノルマ外の休み記号を `COUNTIF` の和 |
| AJ | ○早番 | `COUNTIF(...,"○")+COUNTIF(...,"◯")` |
| AK | ▲遅番 | `COUNTIF(...,"▲")` |
| AL | ●遅半 | `COUNTIF(...,"●")` |
| AM | 5診出勤 | `SUMPRODUCT((B$31:AF$31=5)*((B14:AF14="○")+...))` |

- 休み記号の全体は `公休,希休,夏休,有休,有休※` の5つ。
  これを設定 L11「ノルマ外の休み記号」の**部分一致**で
  AH（ノルマ対象）と AI（ノルマ外）に振り分ける。
  既定 `有休,夏休` なら AH=`公休,希休` / AI=`夏休,有休,有休※`。
  **判定は `Engine` の `isPaidOff` と必ず同じ規則にすること**
  （L11 に「有休」とだけ書けば「有休※」も外れる、という約束）
- 数える記号が0個になる場合は `=0` を書く（`=` だけでは壊れる）
- 見出しは「空欄 or **過去にマクロが書いた見出し**」のときだけ上書きする。
  既知の見出し一覧（`休, ノルマ休, 公休, 有休, ○早番, ▲遅番, ●遅半, 5診出勤`）
  を持っておき、それ以外は手書きとみなして触らない
- A列に氏名が無い行は集計列を空にする

### 5.5 名前付き範囲

| 名前 | 中身 |
|---|---|
| `シフト入力範囲` | スタッフの行 × 日付の列（`B{gridTop}:AF{gridBottom}`） |
| `医師名リスト範囲` | 医師名欄（目印。マクロは読まない） |
| `備考行範囲` | 備考の1行 |
| ~~`シフトパレット`~~ | **不要**（サイドバー化で廃止） |
| ~~`シフトパレット範囲`~~ | 旧名。存在したら削除する |

VBA 版は `OFFSET` / `INDEX` を使った相対参照の名前定義にしていたが、
Sheets の名前付き範囲は**数式を持てず、範囲アドレスしか持てない**。
`spreadsheet.setNamedRange(name, range)` で毎回貼り直す形になる。
そのため「行を増減すると名前が古くなる」問題は VBA 版より起きやすい。

→ **`Layout.gs` の計算解決を正とし、名前付き範囲は利用者向けの目印**
という位置づけをはっきりさせること。設定チェックで両者のずれを警告する。

---

## 6. サイドバー UI（`ShiftClick` の代替）

### 6.1 失われる操作と代替

| VBA の操作 | GAS での代替 |
|---|---|
| パレットのセルをクリック → モード切替 | サイドバーのボタンを押す（選択状態はサイドバー内で保持） |
| 入力欄をダブルクリック → スタンプを押す | 範囲を選んでサイドバーのボタンを押す |
| 範囲を選んで右クリック → まとめてスタンプ | 同上（**むしろ自然になる**） |
| ダブルクリック → 次の記号へ順送り | 「次へ ▶」ボタン |
| 右クリック → 前の記号へ | 「◀ 前へ」ボタン |
| ★マーカー行で現在のモードを表示 | サイドバーのボタンのハイライト |
| ステータスバーにモード説明 | サイドバー下部の説明テキスト |
| `OFF` ボタン（マクロ停止） | サイドバーを閉じる |

**設計の要点**: サイドバーは「押した瞬間の選択範囲」に対して作用する。
Sheets ではこれが最も自然な操作で、VBA 版の「範囲を選んで右クリック」に相当する。
モードを保持してからセルを触る、という二段階は要らなくなる。

### 6.2 画面構成

```
┌─ シフト入力 ─────────────┐
│ [自動作成] [変更を戻す] [PDF出力]  │  ← 動作ボタン
├──────────────────────┤
│ シフト記号                          │
│  [ ○ 早番 ] [ ● 遅半 ] [ ▲ 遅番 ]  │
│  [ 公休 ] [ 希休 ] [ 夏休 ]         │
│  [ 有休 ] [ 有休※ ]                │
│  [ 消去 ]                           │
├──────────────────────┤
│ 順送り   [ ◀ 前へ ] [ 次へ ▶ ]     │  ← 単一セル選択時のみ有効
├──────────────────────┤
│ 背景色   [緑] [橙] [灰] [色消]      │
├──────────────────────┤
│ 医師名   [▼ 医師名を選ぶ]           │  ← 医師名欄にのみ押せる
│ 備考     [ 銀行 ]                   │  ← 備考行にのみ押せる
├──────────────────────┤
│ 選択中: B14:D14（シフト入力欄・3セル）│  ← 状態表示
└──────────────────────┘
```

### 6.3 押せる場所の制約（`StampAllowedHere` の移植）

VBA 版と同じ規則を守る。記号の種類と書き込み先が噛み合わないと集計がずれる。

| 書き込み先 | 押せるもの |
|---|---|
| シフト入力欄 | シフト記号のみ（医師名・備考スタンプは不可） |
| 備考行 | 備考スタンプ（銀行など）+ 消去 / 色消 |
| 医師名欄 | 医師名スタンプ + 消去 / 色消 |

`消去` と `色消` はどこでも許可する（書き間違いを直せなくなるため）。
押せない組み合わせはボタンを無効化し、理由をテキストで示す。

### 6.4 医師名スタンプ

**コードに実名を書かない**という VBA 版の制約を守ること。
医師名の候補は次の順で集める。

1. 医師名欄（`doctorTop`〜`doctorBottom` × B〜AF）に既に入っている値の重複除去
2. それでも空なら、利用者がサイドバーのテキスト欄に直接入力する

VBA 版はパレット行に医師名を保持していたが、その置き場が無くなる。
**`自動作成設定` シートに「医師名リスト」欄（例 N 列）を新設して
そこを正とする**のが素直。`Schema.gs` で生成する。

### 6.5 スタンプの適用

```javascript
// 値 + 太字だけを書く。背景色・文字色は持ち込まない（VBA v9.4 と同じ）
range.setValue(sym);
range.setFontWeight(bold ? "bold" : "normal");
```

- 数式の入ったセルは書き換えない（`getFormulas()` で判定）
- 背景色ボタンは**背景色だけ塗る**（値・文字色は触らない）
- 色消は背景色だけ消す（値は残す）
- 複数セルは `setValues()` / `setFontWeights()` で**一括**（1セルずつ書かない）

### 6.6 手動変更のログ

VBA 版は `Worksheet_SelectionChange` で変更前の状態を退避し、
`Worksheet_Change` でログに書いていた。GAS にはこの経路が無い。

**サイドバー経由の変更は、書き込む直前に旧値を読んでログに積む**
（サイドバーが唯一の入力経路なので、これで漏れない）。

セル直接編集もログに残したいなら、インストーラブル `onEdit` トリガを足す。
ただし旧値は `e.oldValue`（単一セル編集時のみ）に限られ、
範囲貼り付けでは取れない。**まずはサイドバー経由だけを対象にし、
「直接編集はログに残らない」ことを README に明記する**のを推奨。

### 6.7 月送り

VBA 版はスピンボタン（Forms コントロール）で `AG4` の年月シリアルを動かし、
`Worksheet_Calculate` から期替わり判定を呼んでいた。

GAS 版はサイドバーに `[◀ 前月] 2026年9月 [翌月 ▶]` を置き、
押したら `AG{headerRow}` を書き換え、`(年-1900)*12 + 月` の値で持つ。
書き換え後に**期替わり判定**（対象月が変わったら変更ログをリセットするか問う）
を同じ関数から呼ぶ。VBA の「初回は記憶するだけ」「年月の粒度で比較」
「問う前に記憶を更新」の3つの約束はそのまま移植する
（記憶は `PropertiesService.getDocumentProperties()`）。

---

## 7. 周辺機能

### 7.1 エラーログ（`Log.gs`）

VBA 版は `C:\VBAErrorLogs\ErrorLog_YYYYMMDD.csv` に CSV を吐いていた。
GAS では次の3段構えにする（Tier 2 の GAS ルールに沿う）。

```javascript
function logError(moduleName, funcName, error, context) {
  console.error(`[${moduleName}.${funcName}] ${error.message}\n` +
                `context: ${context}\nstack: ${error.stack}`);
  appendLogRow_("ERROR", moduleName, funcName, error.message, context);
  // 致命的なものだけ CONFIG.ADMIN_EMAIL へ通知
}
function logSuccess(moduleName, funcName, details) {
  console.log(`[${moduleName}.${funcName}] ${details}`);
  appendLogRow_("OK", moduleName, funcName, details, "");
}
```

- **`Logger.log()` は使わない**（Tier 2 の禁止事項）
- 実行ログシート（例 `実行ログ`）に追記する。行数が増えるので
  上限（例 2000 行）を超えたら古い行から削る
- `LogSuccess` を全関数の正常終了時に呼ぶ規約は**そのまま維持**する。
  テストの合否をログで判定する運用が VBA 版から続いているため
- CoverBalance / FiveBalance の診断文字列（`shortDays=..; movable=..;
  canWork=..; canRest=..; rawPairs=..; pairs=..; blkRun=..; blkOff=..`）は
  **必ず移植する**。1手も動かないときの切り分けがこれしかない

### 7.2 祝日マスタの取込（`Holidays.gs`）

Power Query → `UrlFetchApp`。**むしろ簡単になる**。

```javascript
const HOLIDAY_CSV_URL = "https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv";

function importHolidays() {
  const res = UrlFetchApp.fetch(HOLIDAY_CSV_URL);
  // 内閣府の CSV は Shift-JIS。GAS は Shift_JIS のデコードに対応している
  const text = res.getBlob().getDataAsString("Shift_JIS");
  const rows = Utilities.parseCsv(text);   // [["国民の祝日・休日月日","名称"], ...]
  // 1行目は見出し。日付は "2026/1/1" 形式
}
```

- `script.external_request` スコープが要る
- 書き込みは **1回の `setValues()`** で。既存データは全消去してから貼り直す
- Excel 2016 以降が要るという VBA 版の制限は消える

### 7.3 PDF 出力（`Export.gs`）

出力範囲は VBA 版と同じ **年月・タイトル行 〜 過不足行 / A 〜 AM**。

Sheets には「値と書式を固めた別ブックを作って印刷設定を当てる」という
VBA 版の手順は要らない。エクスポート URL に範囲と印刷設定を渡せる。

```javascript
const ss = SpreadsheetApp.getActive();
const url = `https://docs.google.com/spreadsheets/d/${ss.getId()}/export?` +
  `format=pdf&gid=${sheet.getSheetId()}` +
  `&portrait=false&fitw=true&gridlines=false&printtitle=false&sheetnames=false` +
  `&top_margin=0.24&bottom_margin=0.24&left_margin=0.24&right_margin=0.24` +
  `&r1=${top-1}&r2=${bottom}&c1=0&c2=${lastCol}`;
const blob = UrlFetchApp.fetch(url, {
  headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }
}).getBlob().setName(fileName + ".pdf");
DriveApp.createFile(blob);
```

- `MARGIN_CM = 0.6` → インチに直すと約 0.24
- VBA 版は横向き・幅1ページに収める設定（`fitw=true&portrait=false` が対応）
- 保存先は Drive のフォルダ。**`CONFIG.EXPORT_FOLDER_ID` に持たせ、
  ロジックにハードコードしない**（Tier 1・Tier 2 のルール）
- 既定ファイル名は VBA 版の `XP_DefaultName` に合わせる

### 7.4 シート構造調査（`Survey.gs`）

読み取り専用。優先度は最後でよい。氏名のマスク（`MASK_NAMES = true`）は
個人情報保護のため**必ず維持する**。

---

## 8. 実行時間とパフォーマンス

### 8.1 6分の壁

| アカウント | 上限 |
|---|---|
| 一般（@gmail.com） | 6分 |
| Workspace | 30分 |

### 8.2 計算量の見積もり（薬剤師20名 × 31日を想定）

| 工程 | 概算 | 評価 |
|---|---|---|
| 公休ノルマ / 残ノルマ | 人 × 日 × 週 ≒ 3千 | 無視できる |
| 連勤緩和 | 3巡 × 人 × 日 × 日 ≒ 6万 | 無視できる |
| `CB_1名移す` | 500巡 × 人 × 日 × 日 ≒ 1千万 | 数百 ms |
| **`CB_2名移す`** | **1回で 日×人×日×人×日 ≒ 1200万** | **要注意** |
| `FiveBalance` | 100巡 × 人² × 日² ≒ 3800万 | 数秒 |
| `SymbolBalance` | 300巡 × 3 × (人 + 日) | 無視できる |
| `CB_診断` / `FB_診断` | 各1回 × 人×日×日 ≒ 2万 | 無視できる |

### 8.3 対策（実装時に必ず入れる）

1. **エンジンは純粋な JS 配列だけで回す。** `SpreadsheetApp` を工程の
   途中で一切呼ばない。VBA 版が `mGrid.Cells(i,j).Value` を
   工程内で読んでいる箇所（`AS_公休ノルマ` の `IsPaidOff` 判定、
   `AP_既存記号を数える`、`AP_日別既存数`、`AP_日別遅番数`、
   `AP_レポート個人別`）は、**最初に読んだ `existing[][]` を参照する形に
   置き換える**。ここを見落とすと API 呼び出しが数万回になり確実に落ちる
2. **`CB_2名移す` に別の打ち切りを設ける。** 500巡すべてが玉突きに
   落ちると 60億ステップになる。`CB_CHAIN_MAX_PASS = 50` 程度を推奨。
   VBA 版に無い制限なので、**入れたことを README に書く**
3. 読み書きは1回ずつ。`getValues` / `getFormulas` / `getBackgrounds` /
   `getFontWeights` を工程の前に、`setValues` / `setBackgrounds` /
   `setFontWeights` を工程の後に、それぞれ**範囲まるごと1回**
4. `SpreadsheetApp.flush()` は書き込みの最後に1回だけ
5. 実行時間を計り、`logSuccess` に `elapsedMs` を必ず載せる

---

## 9. 実装フェーズ

各フェーズの終わりに動くものができ、次に進める形にする。

| # | 内容 | 完了の目安 |
|---|---|---|
| 1 | `Config.gs` / `Layout.gs` / `Log.gs` / `Menu.gs` | メニューから「シート構造を表示」が動き、位置解決が正しい |
| 2 | `Schema.gs` / `Setup.gs` | 空のスプレッドシートから設定・祝日・ログの3シートと数式・名前付き範囲が生成できる |
| 3 | **`Engine.gs`（純粋関数）** | 手書きの入力データで `runEngine()` が動き、VBA 版と同じ配置を返す |
| 4 | `ShiftAuto.gs` / `Report.gs` / `SettingsCheck.gs` | シート上で自動作成が通り、レポートが出る |
| 5 | `ChangeLog.gs` | 変更ログが記録され、セッション単位で巻き戻せる |
| 6 | `Sidebar.gs` / `Sidebar.html` | スタンプ入力・順送り・背景色・月送りが動く |
| 7 | `Holidays.gs` / `Export.gs` | 祝日取込と PDF 出力 |
| 8 | `Survey.gs` / README / CLAUDE.md | 仕上げ |

### フェーズ3の検証方法（重要）

エンジンが純粋関数なので、**VBA 版と同じ入力を与えて同じ出力になるか**を
機械的に比べられる。移植の正しさを担保する唯一の現実的な手段なので、
これを飛ばさないこと。

1. VBA 版で実データ（氏名は匿名化）に対し自動作成を実行し、
   `mPlan` / `mSymb` に相当する結果をシートから吸い出して JSON にする
2. 同じ入力を `runEngine()` に与え、`plan` / `symbol` を突き合わせる
3. 差が出たら**エンジン側のバグ**として扱う。
   アルゴリズムを「改善」しない。改善は移植が終わってから別の変更として行う

---

## 10. 移植時に落としやすい罠（チェックリスト）

- [ ] `◯`（全角の別字体）を `○` と同じ早番として扱っているか（`isEarlySym`）
- [ ] `ST_FWORK` / `ST_FOFF` を自動処理で書き換えていないか
- [ ] 月間休日数を `通常` ルール以外で読んでいないか
- [ ] 公休ノルマの計算で「ノルマ外の休み記号」を除外しているか
- [ ] `isPaidOff` が**部分一致**か（「有休」で「有休※」も拾う）
- [ ] 集計列 AH/AI の振り分けが `isPaidOff` と同じ規則になっているか
- [ ] `targetOff` が土日 + **平日の**祝日か（土日祝の二重計上をしていないか）
- [ ] 週キーが**日曜起点**か
- [ ] 連勤/連休の判定を「**交換した後の盤面**」で行っているか
- [ ] 判定のために盤面を動かしたら、**例外時も含めて必ず戻して**いるか
- [ ] `CoverBalance` の連勤上限が `maxRun + runBonus`、
      `FiveBalance` が `maxRun`（上乗せなし）になっているか
- [ ] `固定曜日` の人を連勤緩和・CoverBalance・FiveBalance の対象から外しているか
- [ ] `週N日` の人の入替を同じ週の中に限っているか
- [ ] 記号割当の候補選びで走査開始位置を日ごとにずらしているか
- [ ] 空行・集計行（`skipRow`）に一切書き込んでいないか
- [ ] 数式セルを書き換えていないか
- [ ] 薬剤師出勤数の数式で `MATCH` に配列を渡していないか（§5.3）
- [ ] 集計行・集計列の見出しを「空欄 or マクロが書いたもの」のときだけ上書きしているか
- [ ] 設定の生成が**空欄のセルにしか書かない**（既存の値を消さない）か
- [ ] 休業行の塗りを外すのが「マクロが塗った色と同じ場合」だけか
- [ ] 診断ログ（`CB_診断` / `FB_診断`）を移植したか
- [ ] 工程の途中で `SpreadsheetApp` を呼んでいないか（§8.3-1）
- [ ] 関数名が camelCase の英語か（Tier 2 のルール。日本語はメニュー表示だけ）
- [ ] 全関数に `try/catch` があるか、`console.error` で記録しているか
- [ ] ID・シート名がすべて `Config.gs` にあるか（ロジックにハードコードしていないか）

---

## 11. 参照

- VBA 版ソース: `GitHub/VBA/Auto_Shift_Generator/src/*.bas`（**読み取り専用**）
- VBA 版ドキュメント: `docs/SETUP-ja.md` / `docs/manual.html`
- Tier 1: `GitHub/CLAUDE.md`
- Tier 2: `GitHub/GAS/CLAUDE.md`
- 内閣府 祝日 CSV: `https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv`
