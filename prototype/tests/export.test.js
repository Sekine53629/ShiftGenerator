// .xlsx を組み立てるところを、Excel も表計算ソフトも使わずに確かめる。
//
// xlsx は「XML を集めた zip」なので、壊れていても書き出しは成功してしまう。
// 壊れているかどうかは、開いた人が初めて気づく。ここで開く側をやる。
//
//   node prototype/tests/export.test.js
const fs = require('fs');
const assert = require('assert');
const src = fs.readFileSync('prototype/ShiftGrid.html', 'utf8');

function grab(n) {
  const at = src.indexOf('function ' + n + '(');
  if (at < 0) throw new Error('見つからない: ' + n);
  let d = 0;
  for (let j = src.indexOf('{', at); j < src.length; j++) {
    if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) return src.slice(at, j + 1); }
  }
}
const L = t => src.split(/\r?\n/).find(l => l.includes(t));
/**
 * 目印から、その文の終わりまで。
 * 最初の ';' で切ると、括弧や文字列の中の ';' で切れる
 * （'&amp;' の ';' で切れて、読み込みが構文エラーになった）。
 */
function stmt(marker) {
  let i = src.indexOf(marker);
  if (i < 0) throw new Error('見つからない: ' + marker);
  const start = i;
  let depth = 0, q = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === BS) i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf(NL, i); continue; }
    if (c === '/' && (src[i - 1] === '(' || src[i - 1] === ' ')) {   // 正規表現
      for (i++; i < src.length && src[i] !== '/'; i++) if (src[i] === BS) i++;
      continue;
    }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ';' && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('文の終わりが見つからない: ' + marker);
}
const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);

// 書き出しは DOM に触らない（触ると Node で試せない）。ここで組み立てて確かめる
const api = new Function([
  'const DAY_COLS = 31;',
  'const WAREKI_BASE = 2018;',
  stmt('const CRC_TABLE ='),
  grab('crc32_'),
  L('  const utf8_ ='),
  grab('zipStore_'),
  stmt('const xmlEsc_ ='),
  grab('colName_'),
  stmt('const XL_TPL ='),
  stmt('const OUT_COLOR_ITEMS ='),
  grab('outColorsOf_'),
  grab('tplDayBg_'),
  stmt('const PRINT_SHEET ='),
  grab('buildPrintSheet_'),
  grab('buildTemplateXlsx_'),
  grab('xlsxPackage_'),
  'return { crc32_, zipStore_, xmlEsc_, colName_, buildTemplateXlsx_, buildPrintSheet_, outColorsOf_, utf8_ };',
].join('\n'))();

let fail = 0;
const ok = (name, fn) => {
  try { fn(); console.log('  OK  ' + name); }
  catch (e) { fail++; console.log('  NG  ' + name + '\n      ' + e.message); }
};

/* ── zip を読み戻す（無圧縮なので、頭を辿るだけで開ける）── */
function unzip(bytes) {
  const b = Buffer.from(bytes);
  const out = {};
  let at = 0;
  while (b.readUInt32LE(at) === 0x04034b50) {
    const method = b.readUInt16LE(at + 8);
    assert.strictEqual(method, 0, '無圧縮で入れているはず');
    const crc = b.readUInt32LE(at + 14);
    const size = b.readUInt32LE(at + 18);
    const nlen = b.readUInt16LE(at + 26);
    const elen = b.readUInt16LE(at + 28);
    const name = b.slice(at + 30, at + 30 + nlen).toString('utf8');
    const data = b.slice(at + 30 + nlen + elen, at + 30 + nlen + elen + size);
    out[name] = { text: data.toString('utf8'), crc: crc, size: size };
    at += 30 + nlen + elen + size;
  }
  assert.ok(Object.keys(out).length, '中身が1つも読めない');
  // 中央ディレクトリと EOCD が続いているか
  assert.strictEqual(b.readUInt32LE(at), 0x02014b50, '中央ディレクトリが無い');
  const eocd = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd > 0, 'EOCD が無い');
  assert.strictEqual(b.readUInt16LE(eocd + 10), Object.keys(out).length,
    'EOCD の件数が合わない');
  assert.strictEqual(b.length, eocd + 22, 'EOCD の後ろに余分が付いている');
  return out;
}

/** XML の入れ子が閉じているか。開き括弧の数合わせでは通ってしまうので順序も見る */
function xmlWellFormed(text) {
  const stack = [];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[3].endsWith('?') || m[2] === 'xml') continue;      // 宣言
    if (m[1]) {
      const open = stack.pop();
      assert.strictEqual(open, m[2], '閉じ方が違う: ' + open + ' を ' + m[2] + ' で閉じた');
    } else if (!m[4]) stack.push(m[2]);
  }
  assert.strictEqual(stack.length, 0, '閉じていない: ' + stack.join(','));
}

console.log('■ 部品');

ok('列名は 0→A、25→Z、26→AA、37→AL', () => {
  assert.strictEqual(api.colName_(0), 'A');
  assert.strictEqual(api.colName_(25), 'Z');
  assert.strictEqual(api.colName_(26), 'AA');
  assert.strictEqual(api.colName_(37), 'AL');   // 氏名1 + 日付31 + 集計6
});

ok('CRC32 は規格の検査値と合う', () => {
  // "123456789" の CRC32 は 0xCBF43926（どの実装でもこの値になる）
  assert.strictEqual(api.crc32_(api.utf8_('123456789')), 0xCBF43926);
  assert.strictEqual(api.crc32_(new Uint8Array(0)), 0);
});

ok('XML の特殊文字を逃がす', () => {
  assert.strictEqual(api.xmlEsc_('a&b<c>d"e'), 'a&amp;b&lt;c&gt;d&quot;e');
  assert.strictEqual(api.xmlEsc_(null), '');
  assert.strictEqual(api.xmlEsc_(0), '0');      // 0 を空にしない
});

ok('zip に入れたものが、そのまま読み戻せる', () => {
  const files = [
    { name: 'a.xml', data: api.utf8_('<x/>') },
    { name: 'dir/b.txt', data: api.utf8_('日本語も入る') },
  ];
  const got = unzip(api.zipStore_(files));
  assert.deepStrictEqual(Object.keys(got), ['a.xml', 'dir/b.txt']);
  assert.strictEqual(got['a.xml'].text, '<x/>');
  assert.strictEqual(got['dir/b.txt'].text, '日本語も入る');
  assert.strictEqual(got['a.xml'].crc, api.crc32_(files[0].data), 'CRC が合わない');
});

ok('同じ中身なら同じバイト列になる（日時を固定してある）', () => {
  const mk = () => api.zipStore_([{ name: 'a', data: api.utf8_('x') }]);
  assert.deepStrictEqual(Array.from(mk()), Array.from(mk()));
});

/* ── 表そのもの（見本の様式）────────────────────────────── */

// templateModel_ が返す形。2026年11月（30日・1日は日曜・3日と23日は祝日）
const DOWS = Array.from({ length: 31 }, (_, c) => (c < 30 ? new Date(2026, 10, c + 1).getDay() : -1));
const blank = () => Array.from({ length: 31 }, () => ({ v: '', bg: null }));
const staff = (name, vals, bgs) => ({
  name: name,
  cells: blank().map((x, c) => ({ v: vals[c] || '', bg: (bgs && bgs[c]) || null })),
});
const NEED = { d0: 3, p0: 4, d1: 7, p1: 7 };
const TM = {
  title: 'R8.11月',
  quota: '土日公休9回　祝日2回　休みのトータル11回',
  store: 'さくら薬局北口店',
  year: 2026, month: 11,
  days: DOWS.map((d, c) => ({ day: c + 1, inMonth: c < 30, dow: d, holiday: c === 2 || c === 22 })),
  doctors: [['', '甲', '乙'], ['', '丙']].map(a => Array.from({ length: 31 }, (_, c) => a[c] || '')),
  groups: [
    { role: 'pharm', rows: [staff('薬剤師 1', ['公休', '○', '▲'], [null, '#A9D08E']),
                            staff('薬剤師 2', ['希休', '▲', '●'], [null, null, '#D0CECE'])] },
    { role: 'dispatch', rows: [staff('派遣 1', ['', '●'])] },
    { role: 'clerk', rows: [staff('事務 1', ['', '○'])] },
  ],
  note: Array.from({ length: 31 }, (_, c) => (c === 1 ? '銀行' : '')),
  legend: ['○　早番　10:00～19:00'],
  offLegend: '公休（公休枠）　有休',
  marks: [{ color: '#a9d18e', label: '薬品発注担当' }],
  memo: ['【休憩について】13時〜14時'],
  calc: {
    aggHeads: ['公休', '有休', '○早番', '▲遅番', '●遅半', '5診出勤'],
    aggSyms: [['公休', '希休'], ['有休', '有休※'], ['○', '◯'], ['▲'], ['●'], null],
    work: ['◯', '○', '▲', '●'],
    busyN: 5,
    need: NEED,
  },
};

console.log('■ できあがった .xlsx（見本の様式）');

const book = unzip(api.buildTemplateXlsx_(TM));
const sheet = book['xl/worksheets/sheet1.xml'].text;
const styles = book['xl/styles.xml'].text;
// 行番号: 1 表題 / 2 日付 / 3 曜日 / 4,5 医師 / 6 再掲 / 7,8 薬剤師 / 9 派遣 / 10 事務
//         / 11 備考 / 12 空き / 13 医師数 / 14 薬剤師出勤数 / 15 事務員出勤数 / 16 過不足
const unesc = t => t.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
const cellXml = ref => (new RegExp('<c r="' + ref + '"[^>]*?(/>|>.*?</c>)').exec(sheet) || [''])[0];
const fOf = ref => { const m = /<f>([^<]*)<\/f>/.exec(cellXml(ref)); return m ? unesc(m[1]) : null; };
const textOf = ref => { const m = /<t[^>]*>([^<]*)<\/t>/.exec(cellXml(ref)); return m ? unesc(m[1]) : null; };
const styleOf = ref => Number((/ s="(\d+)"/.exec(cellXml(ref)) || [])[1]);
const xfs = (styles.slice(styles.indexOf('<cellXfs'), styles.indexOf('</cellXfs>'))
  .match(/<xf [^>]*>/g) || []);
const fillList = styles.slice(styles.indexOf('<fills'), styles.indexOf('</fills>')).match(/<fill>.*?<\/fill>/g) || [];
const fillOf = ref => {
  const fi = Number(/fillId="(\d+)"/.exec(xfs[styleOf(ref)])[1]);
  const m = /rgb="FF([0-9A-F]{6})"/.exec(fillList[fi]);
  return m ? m[1] : null;
};

ok('Excel が要求する部品が揃っている', () => {
  ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
   'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']
    .forEach(n => assert.ok(book[n], '足りない: ' + n));
});

ok('どの XML も閉じている', () => {
  Object.keys(book).forEach(n => {
    try { xmlWellFormed(book[n].text); }
    catch (e) { throw new Error(n + ': ' + e.message); }
  });
});

ok('見本の位置: 1行目 表題、2行目 日付、3行目 曜日、A 列 氏名、B〜AF 日', () => {
  assert.strictEqual(textOf('A1'), 'R8.11月');
  assert.ok(/<c r="B2"[^>]*><v>1<\/v>/.test(sheet), '2行目の B が 1日でない');
  assert.ok(/<c r="AE2"[^>]*><v>30<\/v>/.test(sheet), '30日が AE でない');
  assert.strictEqual(textOf('B3'), '日');
  assert.strictEqual(textOf('A7'), '薬剤師 1');
  assert.strictEqual(textOf('A10'), '事務 1', '派遣と事務のあいだに帯を入れない（見本と同じ）');
});

ok('土曜は青・日曜は赤・祝日は橙・月の外は灰（シフト担当者の色）', () => {
  assert.strictEqual(fillOf('B2'), 'FF6D6D', '日曜');
  assert.strictEqual(fillOf('D2'), 'FFC000', '祝日（3日）は橙');
  assert.strictEqual(fillOf('D3'), 'FFC000', '曜日の行も橙');
  assert.strictEqual(fillOf('D6'), 'FFC000', '日付の再掲も橙');
  assert.strictEqual(fillOf('H3'), 'BDD7EE', '土曜（7日）');
  assert.strictEqual(fillOf('C2'), null, '平日は塗らない');
  assert.strictEqual(fillOf('AF2'), 'D0CECE', '31日（月の外）');
});

ok('AG 列は灰色の仕切り。集計は AH から', () => {
  assert.strictEqual(fillOf('AG7'), 'D0CECE');
  assert.strictEqual(textOf('AH6'), '公休');
  assert.strictEqual(textOf('AM6'), '5診出勤');
});

ok('集計の見出しの色は見本どおり（○ 赤・▲ 青・● 緑）', () => {
  const fonts = styles.slice(styles.indexOf('<fonts'), styles.indexOf('</fonts>')).match(/<font>.*?<\/font>/g);
  const ink = ref => {
    const fid = Number(/fontId="(\d+)"/.exec(xfs[styleOf(ref)])[1]);
    return (/rgb="FF([0-9A-F]{6})"/.exec(fonts[fid]) || [])[1] || null;
  };
  assert.strictEqual(ink('AJ6'), 'FF0000');
  assert.strictEqual(ink('AK6'), '4472C4');
  assert.strictEqual(ink('AL6'), '70AD47');
});

ok('日曜に重なる祝日は日曜の赤', () => {
  const t = JSON.parse(JSON.stringify(TM));
  t.days[7].holiday = true;                      // 8日（日）
  const x = unzip(api.buildTemplateXlsx_(t));
  const sh = x['xl/worksheets/sheet1.xml'].text, st = x['xl/styles.xml'].text;
  const s = Number(/<c r="I2" s="(\d+)"/.exec(sh)[1]);
  const xf = st.slice(st.indexOf('<cellXfs')).match(/<xf [^>]*>/g)[s];
  const fi = Number(/fillId="(\d+)"/.exec(xf)[1]);
  assert.ok(st.slice(st.indexOf('<fills')).match(/<fill>.*?<\/fill>/g)[fi].includes('FFFF6D6D'));
});

ok('薬剤師は氏名だけ緑、派遣は行ごと青、事務は行ごと橙', () => {
  assert.strictEqual(fillOf('A7'), 'E2EFDA', '薬剤師の氏名');
  assert.strictEqual(fillOf('E7'), null, '薬剤師の日の欄は塗らない');
  assert.strictEqual(fillOf('A9'), 'DDEBF7', '派遣の氏名');
  assert.strictEqual(fillOf('E9'), 'DDEBF7', '派遣の日の欄');
  assert.strictEqual(fillOf('A10'), 'FCE4D6', '事務の氏名');
  assert.strictEqual(fillOf('E10'), 'FCE4D6', '事務の日の欄');
  assert.strictEqual(fillOf('AF10'), 'D0CECE', '月の外は行の色より灰');
});

ok('印の色・出られない日の灰は、セルの塗りになる', () => {
  assert.strictEqual(fillOf('C7'), 'A9D08E');
  assert.strictEqual(fillOf('D8'), 'D0CECE');
});

ok('字体は見本どおり（日付 Arial 13・曜日 ＭＳ Ｐゴシック・表題 28）', () => {
  assert.ok(styles.includes('<sz val="13"/><name val="Arial"/>'), 'Arial 13 が無い');
  assert.ok(styles.includes('<name val="ＭＳ Ｐゴシック"/>'), 'ＭＳ Ｐゴシックが無い');
  assert.ok(styles.includes('<sz val="28"/>'), '表題 28pt が無い');
});

ok('列幅・倍率・印刷は見本どおり', () => {
  assert.ok(sheet.includes('min="1" max="1" width="12.4"'), '氏名列');
  assert.ok(sheet.includes('min="2" max="33" width="5.5"'), '日付列と仕切り');
  assert.ok(sheet.includes('min="34" max="39" width="6.58"'), '集計列');
  assert.ok(/zoomScale="70"/.test(sheet), '70% でない');
  assert.ok(/orientation="landscape"/.test(sheet) && /paperSize="9"/.test(sheet), 'A4 横でない');
  assert.ok(/fitToWidth="1"/.test(sheet) && /fitToPage="1"/.test(sheet), '1枚に収めていない');
});

ok('備考の行を写す（小さい字）', () => {
  assert.strictEqual(textOf('A11'), '備考');
  assert.strictEqual(textOf('C11'), '銀行');
});

ok('凡例は A、注記は F に横並び。色の凡例は B に色・C に意味', () => {
  const rowOf = t => (new RegExp('<row r="(\\d+)"[^>]*>(?:(?!</row>).)*' + t).exec(sheet) || [])[1];
  const lg = rowOf('○　早番'), memo = rowOf('【休憩について】');
  assert.ok(lg && lg === memo, '凡例と注記が同じ行に無い');
  assert.strictEqual(textOf('A' + lg), '○　早番　10:00～19:00');
  assert.strictEqual(textOf('F' + memo), '【休憩について】13時〜14時');
  const mk = rowOf('薬品発注担当');
  assert.strictEqual(textOf('C' + mk), '薬品発注担当');
  assert.strictEqual(fillOf('B' + mk), 'A9D18E');
});

ok('シート名は和暦（ゼロ詰めしない。表題と同じ形）', () => {
  assert.ok(book['xl/workbook.xml'].text.includes('name="R8.11月"'));
});

console.log('■ 集計は数式で入る');

ok('右の集計列は COUNTIF（公休は公休＋希休）', () => {
  assert.strictEqual(fOf('AH7'), 'SUMPRODUCT(COUNTIF(B7:AF7,{"公休","希休"}))');
  assert.strictEqual(fOf('AJ7'), 'SUMPRODUCT(COUNTIF(B7:AF7,{"○","◯"}))');
  assert.strictEqual(fOf('AK8'), 'COUNTIF(B8:AF8,"▲")');
  assert.strictEqual(fOf('AL10'), 'COUNTIF(B10:AF10,"●")', '事務の行にも付く');
});

ok('◯診出勤は医師数の行と COUNTIFS（MATCH に配列を渡さない）', () => {
  const f = fOf('AM7');
  assert.ok(f && f.includes('COUNTIFS($B$13:$AF$13,">=5",B7:AF7,"○")'), f);
  assert.ok(!/MATCH/.test(f), 'MATCH はスプレッドシートで配列を読まない');
});

ok('医師数は医師の行の COUNTA', () => {
  assert.strictEqual(fOf('B13'), 'COUNTA(B4:B5)');
});

ok('薬剤師出勤数は薬剤師と派遣、事務員出勤数は事務だけを数える', () => {
  assert.strictEqual(fOf('C14'), 'SUMPRODUCT(COUNTIF(C7:C9,{"◯","○","▲","●"}))');
  assert.strictEqual(fOf('C15'), 'SUMPRODUCT(COUNTIF(C10:C10,{"◯","○","▲","●"}))');
});

ok('月の外の日（31日）には数式を入れない', () => {
  assert.strictEqual(fOf('AF13'), null);
  assert.strictEqual(fOf('AF16'), null);
});

ok('開いたときに計算し直す（calcPr）', () => {
  assert.ok(/<calcPr[^>]*fullCalcOnLoad="1"/.test(book['xl/workbook.xml'].text));
});

ok('医師の来ない日の「空のセルを参照」の印を出さない', () => {
  assert.ok(/<ignoredError [^>]*emptyCellReference="1"/.test(sheet));
});

ok('過不足は足りない日を赤で出す書式', () => {
  assert.ok(/formatCode="0;\[Red\]\\-0"/.test(styles), '書式が無い');
  assert.ok(/numFmtId="164"/.test(xfs[styleOf('C16')]), '過不足の行に書式が付いていない');
});

ok('過不足の必要人数は、画面の staffNeedOf_ と同じ値になる（医師 0〜10人）', () => {
  const scr = new Function('DB', [grab('needModel_'), grab('needModelOf_'), grab('staffNeedOf_'),
    'return staffNeedOf_;'].join('\n'))({ rules: {} });
  const f = fOf('B16');
  assert.ok(f.startsWith('B14-'), '薬剤師出勤数の行を引いていない: ' + f);
  for (let d = 0; d <= 10; d++) {
    // Excel の式を JS に読み替えて計算する（IF は両方計算しても値は同じ）
    const js = f.replace(/B14/g, '0').replace(/B13/g, String(d))
      .replace(/\^/g, '**').replace(/MAX\(/g, 'Math.max(').replace(/LN\(/g, 'Math.log(')
      .replace(/ROUND\(/g, 'rnd(').replace(/IF\(/g, 'iff(');
    const got = -new Function('rnd', 'iff', 'return ' + js)(
      x => Math.round(x), (c, a, b) => (c ? a : b));
    assert.strictEqual(got, scr(d), '医師 ' + d + ' 人: Excel ' + got + ' / 画面 ' + scr(d));
  }
});

ok('画面の集計と Excel の数式は同じ記号の一覧（AGG_COLS.syms）から作る', () => {
  assert.ok(/aggSyms: AGG_COLS\.map/.test(grab('templateModel_')), 'templateModel_ が AGG_COLS を使っていない');
  assert.ok(/AGG_COLS\[i\]\.syms\(\)/.test(grab('rowAggOf_')), '画面の集計が AGG_COLS.syms を使っていない');
  assert.ok(/rowAggOf_\(/.test(grab('recalc')) && /rowAggOf_\(/.test(grab('templateModel_')),
    '画面と紙で集計の数え方が別になっている');
});

ok('人数が変わると行も数式の範囲も付いてくる', () => {
  const more = JSON.parse(JSON.stringify(TM));
  more.groups[0].rows.push(staff('薬剤師 3', ['○']), staff('薬剤師 4', ['▲']));
  more.doctors.push(Array(31).fill(''));
  const x = unzip(api.buildTemplateXlsx_(more))['xl/worksheets/sheet1.xml'].text;
  // 医師3行（4〜6）・再掲 7・薬剤師4人（8〜11）・派遣 12・事務 13 / 備考 14 / 空き 15 / 医師数 16
  assert.ok(x.includes('<f>COUNTA(B4:B6)</f>'), '医師の範囲が伸びていない');
  assert.ok(x.includes('COUNTIF(C8:C12,'), '薬剤師の範囲が伸びていない');
  assert.ok(x.includes('$B$16:$AF$16'), '◯診出勤が医師数の行を指していない');
});

console.log('■ 紙（PDF）は同じ様式で、紙の中央に1枚で収まる');

// 紙は値を刷る。画面の集計（templateModel_ が添える）を持たせる
const PM = JSON.parse(JSON.stringify(TM));
PM.groups.forEach(g => g.rows.forEach((p, i) => { p.agg = [10 + i, 0, 4, 12, 3, 8]; }));
PM.dayAgg = {
  doc: PM.days.map((d, c) => (d.inMonth ? 4 : null)),
  pharm: PM.days.map((d, c) => (d.inMonth ? 6 : null)),
  clerk: PM.days.map((d, c) => (d.inMonth ? 1 : null)),
  short: PM.days.map((d, c) => (d.inMonth ? (c === 4 ? -2 : 1) : null)),
};
const html = api.buildPrintSheet_(PM);
const trs = html.match(/<tr[^>]*>.*?<\/tr>/g) || [];
const tds = tr => tr.match(/<td[^>]*>[^<]*<\/td>/g) || [];
const tdText = t => t.replace(/<[^>]+>/g, '');
const tdBg = t => ((/background:#([0-9A-Fa-f]{6})/.exec(t) || [])[1] || '').toUpperCase() || null;
// 行: 0 日付 / 1 曜日 / 2,3 医師 / 4 再掲 / 5,6 薬剤師 / 7 派遣 / 8 事務 / 9 備考 / 10 空き / 11〜14 集計

ok('余白は上下左右とも 8mm。表の幅は紙の幅から余白を引いたぶんちょうど', () => {
  const page = /@page\s*\{[^}]*\}/.exec(src)[0];
  assert.ok(/margin:\s*8mm\s*;/.test(page), '余白が左右で違う: ' + page);
  const P = new Function(stmt('const PRINT_SHEET =') + ' return PRINT_SHEET;')();
  assert.strictEqual(P.PAGE_W, 297 - 16, '幅');
  assert.strictEqual(P.PAGE_H, 210 - 16, '高さ');
  assert.ok(/\.ps\s*\{[^}]*width:\s*281mm/.test(src), '.ps の幅が 281mm でない');
  const sum = (html.match(/<col style="width:([\d.]+)%"/g) || [])
    .reduce((a, t) => a + parseFloat(/([\d.]+)%/.exec(t)[1]), 0);
  assert.ok(Math.abs(sum - 100) < 0.05, '列幅の合計が 100% でない: ' + sum);
});

ok('列は Excel と同じ: 氏名・31日・灰の仕切り・集計6列', () => {
  assert.strictEqual(tds(trs[5]).length, 1 + 31 + 1 + 6);
  assert.strictEqual(tdBg(tds(trs[5])[32]), 'D0CECE', '仕切り');
});

ok('日付の色は Excel と同じ（日曜 赤・祝日 橙・土曜 青・月の外 灰）', () => {
  const d = tds(trs[0]);
  assert.strictEqual(tdBg(d[1]), 'FF6D6D');
  assert.strictEqual(tdBg(d[3]), 'FFC000');
  assert.strictEqual(tdBg(d[7]), 'BDD7EE');
  assert.strictEqual(tdBg(d[31]), 'D0CECE');
  assert.strictEqual(tdText(tds(trs[1])[3]), '火');
});

ok('薬剤師は氏名だけ緑、派遣・事務は行ごとの色。印の色が先', () => {
  assert.strictEqual(tdBg(tds(trs[5])[0]), 'E2EFDA');
  assert.strictEqual(tdBg(tds(trs[5])[4]), null);
  assert.strictEqual(tdBg(tds(trs[5])[2]), 'A9D08E', '印の色');
  assert.strictEqual(tdBg(tds(trs[7])[4]), 'DDEBF7');
  assert.strictEqual(tdBg(tds(trs[8])[4]), 'FCE4D6');
});

ok('集計は画面の値をそのまま刷る。見出しの色は Excel と同じ', () => {
  const head = tds(trs[4]);
  assert.strictEqual(tdText(head[33]), '公休');
  assert.ok(/color:#FF0000/.test(head[35]), '○早番の見出しが赤でない');
  assert.strictEqual(tdText(tds(trs[5])[33]), '10');
  assert.strictEqual(tdText(tds(trs[6])[33]), '11');
  assert.strictEqual(tdText(tds(trs[11])[0]), '医師数(診)');
  assert.strictEqual(tdText(tds(trs[11])[2]), '4');
  assert.ok(/class="b neg"/.test(tds(trs[14])[5]), '足りない日が赤くない');
  assert.strictEqual(tdText(tds(trs[14])[5]), '-2');
});

ok('備考・凡例・注記・色の凡例を刷る', () => {
  assert.strictEqual(tdText(tds(trs[9])[2]), '銀行');
  assert.ok(html.includes('○　早番　10:00～19:00'), '凡例');
  assert.ok(html.includes('【休憩について】13時〜14時'), '注記');
  assert.ok(/<i style="background:#a9d18e"><\/i>薬品発注担当/.test(html), '色の凡例');
});

ok('1枚に収まる: 人数が少なければ行を高く、多ければ詰め、詰めきれなければ縮める', () => {
  const P = new Function(stmt('const PRINT_SHEET =') + ' return PRINT_SHEET;')();
  const rowOf = h => parseFloat(/--ps-row:([\d.]+)mm/.exec(h)[1]);
  const zoomOf = h => parseFloat(/zoom:([\d.]+)/.exec(h)[1]);
  assert.strictEqual(rowOf(html), P.ROW_MAX, '少ない人数で行が最大になっていない');
  assert.strictEqual(zoomOf(html), 1);
  const many = JSON.parse(JSON.stringify(PM));
  for (let i = 0; i < 20; i++) many.groups[0].rows.push(Object.assign({}, many.groups[0].rows[0]));
  const h2 = api.buildPrintSheet_(many);
  assert.ok(rowOf(h2) < P.ROW_MAX && rowOf(h2) >= P.ROW_MIN, '20人増やしても行を詰めていない');
  assert.strictEqual(zoomOf(h2), 1, '行を詰めれば入るのに縮めている');
  const huge = JSON.parse(JSON.stringify(PM));
  for (let i = 0; i < 60; i++) huge.groups[0].rows.push(Object.assign({}, huge.groups[0].rows[0]));
  const h3 = api.buildPrintSheet_(huge);
  assert.strictEqual(rowOf(h3), P.ROW_MIN);
  assert.ok(zoomOf(h3) < 1, '詰めきれないのに縮めていない');
});

ok('氏名や注記の < & は逃がす', () => {
  const bad = JSON.parse(JSON.stringify(PM));
  bad.groups[0].rows[0].name = '<script>&';
  bad.memo = ['<b>x</b>'];
  const h = api.buildPrintSheet_(bad);
  assert.ok(!h.includes('<script>') && h.includes('&lt;script&gt;&amp;'));
  assert.ok(h.includes('&lt;b&gt;x&lt;/b&gt;'));
});

ok('画面では隠し、印刷のときはこの表だけを出す', () => {
  assert.ok(/<div id="printSheet"/.test(src), '入れ物が無い');
  assert.ok(/#printSheet\s*\{\s*display:\s*none;\s*\}/.test(src), '画面で隠していない');
  const pr = src.slice(src.indexOf('#printSheet { display: none; }'));
  assert.ok(/body > :not\(#printSheet\)\s*\{\s*display:\s*none !important;/.test(pr), 'ほかを隠していない');
  assert.ok(/body\s*\{\s*zoom:\s*1 !important;/.test(pr), '画面の表の倍率が紙の表に掛かる');
});

ok('印刷の直前に必ず組み直す（PDF ボタンでも Ctrl+P でも）', () => {
  assert.ok(/renderPrintSheet_\(\);\s*window\.print\(\)/.test(grab('exportPdf')), 'PDF ボタン');
  assert.ok(/addEventListener\('beforeprint', renderPrintSheet_\)/.test(src), 'Ctrl+P');
  assert.ok(/buildPrintSheet_\(templateModel_\(\)\)/.test(grab('renderPrintSheet_')), 'Excel と同じ表から組んでいない');
});

console.log('■ 出力の色（「出力の色」タブの設定）');

ok('設定が無ければ既定の色（シフト担当者の塗り方）', () => {
  const K = api.outColorsOf_(undefined);
  assert.strictEqual(K.SAT, '#BDD7EE');
  assert.strictEqual(K.HOLIDAY, '#FFC000');
  assert.strictEqual(K.NAME_BG.pharm, '#E2EFDA');
  assert.strictEqual(K.ROW_BG.pharm, null, '薬剤師のシフトの欄は既定で塗らない');
  assert.strictEqual(K.HEAD_INK['○早番'], '#FF0000');
});

ok('空文字は「塗らない」、読めない値は既定に戻す', () => {
  const K = api.outColorsOf_({ sat: '', sun: 'red', holiday: '#00ff00', dispRow: 123 });
  assert.strictEqual(K.SAT, null);
  assert.strictEqual(K.SUN, '#FF6D6D', '読めない値');
  assert.strictEqual(K.HOLIDAY, '#00FF00', '大文字にそろえる');
  assert.strictEqual(K.ROW_BG.dispatch, '#DDEBF7');
});

ok('設定した色が Excel にも PDF にも同じく出る', () => {
  const t = JSON.parse(JSON.stringify(PM));
  t.colors = { holiday: '#123456', dispRow: '#ABCDEF', clerkName: '', inkEarly: '#00AA00', grey: '#999999' };
  // Excel
  const x = unzip(api.buildTemplateXlsx_(t));
  const sh = x['xl/worksheets/sheet1.xml'].text, st = x['xl/styles.xml'].text;
  const xfL = st.slice(st.indexOf('<cellXfs')).match(/<xf [^>]*>/g);
  const fills = st.slice(st.indexOf('<fills')).match(/<fill>.*?<\/fill>/g);
  const fonts = st.slice(st.indexOf('<fonts')).match(/<font>.*?<\/font>/g);
  const xf = ref => xfL[Number(new RegExp('<c r="' + ref + '" s="(\\d+)"').exec(sh)[1])];
  const fill = ref => (/rgb="FF([0-9A-F]{6})"/.exec(fills[Number(/fillId="(\d+)"/.exec(xf(ref))[1])]) || [])[1] || null;
  assert.strictEqual(fill('D2'), '123456', 'Excel の祝日');
  assert.strictEqual(fill('E9'), 'ABCDEF', 'Excel の派遣');
  assert.strictEqual(fill('A10'), null, 'Excel の事務の氏名（塗らない）');
  assert.strictEqual(fill('AG7'), '999999', 'Excel の仕切り');
  assert.ok(fonts[Number(/fontId="(\d+)"/.exec(xf('AJ6'))[1])].includes('FF00AA00'), 'Excel の見出しの文字');
  // PDF
  const h = api.buildPrintSheet_(t);
  const r = (h.match(/<tr[^>]*>.*?<\/tr>/g) || []);
  const c = tr => tr.match(/<td[^>]*>[^<]*<\/td>/g);
  assert.ok(c(r[0])[3].includes('background:#123456'), 'PDF の祝日');
  assert.ok(c(r[7])[4].includes('background:#ABCDEF'), 'PDF の派遣');
  assert.ok(!/background/.test(c(r[8])[0]), 'PDF の事務の氏名（塗らない）');
  assert.ok(c(r[4])[35].includes('color:#00AA00'), 'PDF の見出しの文字');
});

ok('出られない日は印（na）で渡し、色は設定の灰', () => {
  const t = JSON.parse(JSON.stringify(PM));
  t.groups[0].rows[0].cells[5] = { v: '', bg: null, na: true };
  t.colors = { grey: '#777777' };
  const h = api.buildPrintSheet_(t);
  const tr = (h.match(/<tr[^>]*>.*?<\/tr>/g) || [])[5];
  assert.ok(tr.match(/<td[^>]*>[^<]*<\/td>/g)[6].includes('background:#777777'));
  assert.ok(/na: !!\(inM && naDay_\(r, c\)\)/.test(grab('templateModel_')), 'templateModel_ が na を渡していない');
  assert.ok(/colors: DB\.outColors/.test(grab('templateModel_')), 'templateModel_ が色の設定を渡していない');
});

ok('見本も同じ色の関数で組む', () => {
  const pv = new Function('xmlEsc_', 'tplDayBg_', grab('outColorPreview_') + ' return outColorPreview_;')(
    api.xmlEsc_, new Function(grab('tplDayBg_') + ' return tplDayBg_;')());
  const h = pv(api.outColorsOf_({ holiday: '#112233', clerkRow: '' }));
  assert.ok(h.includes('background:#112233'), '祝日の色');
  assert.ok(h.includes('background:#FCE4D6'), '事務の氏名（既定）');
  assert.ok(/<td>○<\/td>/.test(h), '事務のシフトの欄は塗らない');
});

ok('タブ・保存・取り込みに繋がっている', () => {
  assert.ok(/data-tab="outcolor"/.test(src) && /data-panel="outcolor"/.test(src), 'タブが無い');
  assert.ok(/if \(btn\.dataset\.tab === 'outcolor'\) renderOutColors_\(\);/.test(src), 'タブを開いても組まない');
  assert.ok(/db\.outColors = \{\}/.test(grab('migrateDb_')), '古いデータで outColors を用意していない');
  assert.ok(/'outColors'\]/.test(src), 'データの取り込みで色が落ちる');
  assert.ok(/save\(\);/.test(grab('setOutColor_')), '変えた色を保存していない');
});

console.log('■ 壊れた入力で落ちない');

ok('社員も医師もいない表でも .xlsx として成り立つ', () => {
  const empty = Object.assign({}, TM, {
    doctors: [], groups: TM.groups.map(g => ({ role: g.role, rows: [] })),
    legend: [], offLegend: '', marks: [], memo: [] });
  const b = unzip(api.buildTemplateXlsx_(empty));
  xmlWellFormed(b['xl/worksheets/sheet1.xml'].text);
});

ok('記号や氏名に & < > " が入っても壊れない', () => {
  const nasty = JSON.parse(JSON.stringify(TM));
  nasty.title = 'A&B<C>';
  nasty.store = '"店"';
  nasty.groups[0].rows[0].name = '山田 <太郎>';
  nasty.calc.aggSyms[3] = ['"▲"&'];
  const x = unzip(api.buildTemplateXlsx_(nasty))['xl/worksheets/sheet1.xml'].text;
  xmlWellFormed(x);
  assert.ok(x.includes('A&amp;B&lt;C&gt;'), '表題が逃がされていない');
  assert.ok(x.includes('山田 &lt;太郎&gt;'), '氏名が逃がされていない');
  assert.ok(x.includes('&quot;&quot;&quot;▲&quot;&quot;&amp;&quot;'), '数式の中の " を重ねていない');
});

ok('= で始まる氏名・備考は文字列のまま（数式にしない）', () => {
  const evil = JSON.parse(JSON.stringify(TM));
  evil.groups[0].rows[0].name = '=IMPORTRANGE("x","y")';
  const x = unzip(api.buildTemplateXlsx_(evil))['xl/worksheets/sheet1.xml'].text;
  assert.ok(/<c r="A7"[^>]*t="inlineStr"><is><t[^>]*>=IMPORTRANGE/.test(x), '文字列で入っていない');
});

console.log('■ 配線');

ok('出力ボタンが2つあり、それぞれに繋がっている', () => {
  assert.ok(/id="outPdf"/.test(src) && /id="outXlsx"/.test(src), 'ボタンが無い');
  assert.ok(/\$\('outPdf'\)\.addEventListener\('click', exportPdf\)/.test(src),
    'PDF が繋がっていない');
  assert.ok(/\$\('outXlsx'\)\.addEventListener\('click', exportSheet\)/.test(src),
    'スプレッドシートが繋がっていない');
});

ok('スプレッドシートを先に試し、繋がっていなければ .xlsx で保存する', () => {
  const f = grab('exportSheet');
  assert.ok(/onServer\(\)/.test(f), 'Web アプリかどうかを見ていない');
  assert.ok(/apiExportToSheet\(model\)/.test(f), 'サーバを呼んでいない');
  assert.ok(/withFailureHandler/.test(f), '失敗を黙って捨てている');
  assert.ok(/if \(!onServer\(\)\) \{ exportXlsx_\(\); return; \}/.test(f), '単体で開いたときの控えが無い');
  // 単体のときは見本の様式で出す（画面の格子ではなく、データから組む）
  const x = grab('exportXlsx_');
  assert.ok(/buildTemplateXlsx_\(templateModel_\(\)\)/.test(x), '見本の様式で組んでいない');
  // 表は1回だけ読む。サーバ用と控え用で2回読むと、途中の編集で食い違う
  assert.strictEqual((f.match(/sheetModel_\(\)/g) || []).length, 1,
    '表を2回読んでいる');
});

ok('保存名は PDF も Excel も同じ規則から作る', () => {
  const pdf = grab('exportPdf'), xlsx = grab('exportXlsx_');
  assert.ok(/exportFileName_\(y, m\)/.test(pdf), 'PDF が規則を使っていない');
  assert.ok(/exportFileName_\(y, m, 'xlsx'\)/.test(xlsx), 'Excel が規則を使っていない');
  // 刷ったあとに題を戻さないと、次に保存する名前まで変わる
  assert.ok(/afterprint/.test(pdf) && /document\.title = keep/.test(pdf),
    '印刷後に題を戻していない');
});

ok('色は「刷るときの色」で読む', () => {
  const model = grab('sheetModel_');
  assert.ok(/printMetrics_\(true\)/.test(model) && /printMetrics_\(false\)/.test(model),
    '画面の色をそのまま写している（PDF と Excel で色が食い違う）');
  assert.ok(/finally/.test(model), '途中で落ちると画面が印刷の見た目のまま残る');
});

ok('店舗色や暗い画面を紙に持ち込まない', () => {
  // 店舗色は :root のインライン style に入る。!important でないと勝てず、
  // 暗いを選んだまま刷ると黒地に黒文字の紙が出る
  const print = src.slice(src.indexOf('@media print'));
  const root = print.slice(print.indexOf(':root {'), print.indexOf('}', print.indexOf(':root {')));
  ['--ground', '--band', '--ink', '--na'].forEach(k =>
    assert.ok(new RegExp(k + ':[^;]*!important').test(root), k + ' が !important でない'));
});

console.log(fail ? '\n★ NG ' + fail + ' 件' : '\n書き出し: すべて意図どおり');
process.exit(fail ? 1 : 0);
