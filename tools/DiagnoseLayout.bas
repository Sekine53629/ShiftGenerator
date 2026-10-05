Attribute VB_Name = "DiagnoseLayout"
Option Explicit
'==================================================================
'  シフト表のレイアウト診断（Excel 側）  v1.0
'
'  GAS 版の Layout.resolveLayout が、このシートを読めるかどうかを
'  Excel 上で先に確かめるための道具。
'
'  【なぜ要るか】
'    GAS 側にも同じ診断（シフト → レイアウト診断）があるが、
'    シフト表がまだ Excel にある間は走らせられない。
'    移行の前に「読めるかどうか」と「どこが食い違うか」を知りたい。
'
'  【このファイルの位置づけ】
'    移行用の使い捨てツール。VBA 版のソース（Auto_Shift_Generator/src）には
'    追加しない。GAS 版のリポジトリの tools/ に置く。
'
'  【使い方】
'    1. シフト表のブックを開く
'    2. VBE（Alt+F11）→ ファイル → ファイルのインポート → このファイル
'    3. 診断したいシートを選んだ状態で GASProfile_レイアウト診断 を実行
'    4. 「レイアウト診断」シートに出た内容をコピーして渡す
'
'  【氏名は出さない】
'    B列には医師名が、A列にはスタッフ名が入っている。
'    型と文字数だけを出し、シフト記号など伏せる必要のないものだけ見せる。
'==================================================================

Private Const OUT_SHEET As String = "レイアウト診断"
Private Const MAX_SCAN_ROWS As Long = 200
Private Const DUMP_ROWS As Long = 30

'--- GAS 側 Config.gs の LAYOUT と揃える。ここがズレたら移植が動かない ---
Private Const COL_FIRST As Long = 2       ' B  日付・シフトの開始
Private Const COL_LAST As Long = 32       ' AF 日付・シフトの終端
Private Const COL_MONTH As Long = 33      ' AG 年月シリアル
Private Const COL_AGG_FIRST As Long = 34  ' AH 集計列の開始
Private Const COL_AGG_LAST As Long = 39   ' AM 集計列の終端
Private Const DOC_GAP As Long = 4         ' 入力欄の下端 = 医師数行 - 4
Private Const NOTE_TO_DOC As Long = 2     ' 医師数行 = 備考行 + 2
Private Const DOC_BLOCK_ROWS As Long = 5  ' 医師名欄の行数
Private Const DATE_REPEAT_GAP As Long = 1 ' 入力欄の上端 = 再掲日付行 + 1

Private mLines As Collection


'==================================================================
'  入口
'==================================================================
Public Sub GASProfile_レイアウト診断()
    On Error GoTo ErrHandler
    Dim ws As Worksheet

    Set ws = ActiveSheet
    Set mLines = New Collection

    Say "シフト表レイアウト診断  " & Format$(Now, "yyyy/mm/dd hh:nn")
    Say "ブック: " & ThisWorkbook.Name
    Say "シート: " & ws.Name
    Say "使用範囲: " & ws.UsedRange.Address(False, False)
    Say ""

    DumpColumnB ws
    ReportDateRows ws
    ReportDatesElsewhere ws
    ReportColumnA ws
    ReportResolved ws
    ReportColumns ws

    WriteOut
    MsgBox "「" & OUT_SHEET & "」シートに診断結果を書きました。" & vbCrLf & vbCrLf & _
           "A列をまるごとコピーして渡してください。" & vbCrLf & _
           "※ 氏名・医師名は伏せてあります。", vbInformation
    Exit Sub

ErrHandler:
    MsgBox "診断に失敗しました。" & vbCrLf & vbCrLf & _
           "Err " & Err.Number & ": " & Err.Description, vbCritical
End Sub


'==================================================================
'  B列の中身（型が分からないと原因が特定できない）
'==================================================================
Private Sub DumpColumnB(ByVal ws As Worksheet)
    Dim r As Long

    Say "■ B列の中身（先頭 " & DUMP_ROWS & " 行・氏名は伏せます）"
    Say "  「1」が数値なのか日付なのかは画面では見分けが付きません。"
    For r = 1 To DUMP_ROWS
        Say "  行 " & Right$("  " & r, 3) & ": " & DescribeCell(ws.Cells(r, COL_FIRST))
    Next r
    Say ""
End Sub

'--- セルの中身を言い表す。値そのものは原則出さない ---
Private Function DescribeCell(ByVal c As Range) As String
    Dim mark As String, s As String

    mark = IIf(c.HasFormula, "数式あり", "数式なし")

    If IsEmpty(c.Value) Then
        DescribeCell = mark & " / 空欄"
    ElseIf IsDate(c.Value) Then
        DescribeCell = mark & " / 日付 " & Format$(c.Value, "yyyy-mm-dd") & _
                       "  <= 日付行の候補になれます"
    ElseIf IsNumeric(c.Value) Then
        DescribeCell = mark & " / 数値 " & CStr(c.Value) & _
                       "  <= ★日付ではないので候補になりません"
    Else
        s = Trim$(CStr(c.Value))
        If IsSafeToShow(s) Then
            DescribeCell = mark & " / 文字列「" & s & "」"
        Else
            DescribeCell = mark & " / 文字列（" & Len(s) & "文字・伏せます）"
        End If
    End If
End Function

'--- 伏せなくてよい文字列か（記号と既知のラベルだけ） ---
Private Function IsSafeToShow(ByVal s As String) As Boolean
    Dim safe As Variant, k As Long
    safe = Array("○", "◯", "●", "▲", "公休", "希休", "夏休", "有休", "有休※", _
                 "曜日", "備考", "医師名", "シフトパレット", _
                 "医師数", "医師数(診)", "薬剤師出勤数", "事務員出勤数", "過不足", "合計")
    For k = LBound(safe) To UBound(safe)
        If s = safe(k) Then IsSafeToShow = True: Exit Function
    Next k
End Function


'==================================================================
'  日付行の判定
'==================================================================
Private Sub ReportDateRows(ByVal ws As Worksheet)
    Dim r As Long, hits As String, n As Long, numbers As Long

    Say "■ 日付行の判定"
    Say "  GAS 版は B列で「値が日付」の行を上から2つ探します（数式の有無は問いません）。"

    For r = 1 To MAX_SCAN_ROWS
        With ws.Cells(r, COL_FIRST)
            If Not IsEmpty(.Value) Then
                If IsDate(.Value) Then
                    n = n + 1
                    Say "  行 " & r & ": 日付（" & IIf(.HasFormula, "数式あり", "数式なし") & _
                        "） => 候補 " & n & " 個目"
                    If hits = "" Then hits = CStr(r) Else hits = hits & "," & CStr(r)
                ElseIf IsNumeric(.Value) Then
                    numbers = numbers + 1
                End If
            End If
        End With
    Next r

    If n = 0 Then
        Say "  候補なし。B列に日付が1つもありません。"
        If numbers > 0 Then
            Say "  ★ 代わりに数値が " & numbers & " 個あります。"
            Say "     日付行の「1」「2」がただの数値になっている可能性が高いです。"
        End If
    End If
    Say ""
End Sub


'--- B列以外に日付があるか（開始列が B でない場合の確認） ---
Private Sub ReportDatesElsewhere(ByVal ws As Worksheet)
    Dim r As Long, c As Long, found As String, cnt As Long

    For r = 1 To 40
        For c = 1 To 10
            If c <> COL_FIRST Then
                If Not IsEmpty(ws.Cells(r, c).Value) Then
                    If IsDate(ws.Cells(r, c).Value) Then
                        cnt = cnt + 1
                        If cnt <= 12 Then
                            found = found & IIf(found = "", "", " , ") & _
                                    "行" & r & "/" & ColLetterOf(c) & "列"
                        End If
                        Exit For
                    End If
                End If
            End If
        Next c
    Next r

    If cnt > 0 Then
        Say "■ B列以外にある日付（先頭40行・左10列まで）"
        Say "  " & found
        Say "  日付の開始列が B でないなら、GAS 側の LAYOUT.COL_FIRST を見直します。"
        Say ""
    End If
End Sub


'==================================================================
'  A列のラベル
'==================================================================
Private Sub ReportColumnA(ByVal ws As Worksheet)
    Dim r As Long, v As String, shown As Long

    Say "■ A列のラベル（氏名は伏せます）"
    For r = 1 To MAX_SCAN_ROWS
        v = Trim$(CStr(ws.Cells(r, 1).Value))
        If v <> "" Then
            If IsSafeToShow(v) Or IsKnownPrefix(v) Then
                Say "  行 " & r & ": 「" & v & "」 => 既知のラベル"
                shown = shown + 1
            End If
        End If
    Next r
    If shown = 0 Then Say "  既知のラベルが1つもありません（「備考」「医師数」など）。"
    Say ""
End Sub

'--- 既知のラベルで始まるか（前方一致。GAS の findLabelRow_ と同じ規則） ---
Private Function IsKnownPrefix(ByVal v As String) As Boolean
    Dim keys As Variant, k As Long
    keys = Array("備考", "医師数", "薬剤師出勤数", "事務員出勤数", "過不足", _
                 "合計", "曜日", "医師名", "シフトパレット")
    For k = LBound(keys) To UBound(keys)
        If InStr(1, v, CStr(keys(k))) = 1 Then IsKnownPrefix = True: Exit Function
    Next k
End Function


'==================================================================
'  解決した位置と、GAS 側の定数との整合
'==================================================================
Private Sub ReportResolved(ByVal ws As Worksheet)
    Dim dateRow As Long, repeatRow As Long, noteRow As Long
    Dim docRow As Long, shortRow As Long
    Dim gridTop As Long, gridBottom As Long
    Dim problems As Long

    dateRow = NthDateRow(ws, 1)
    repeatRow = NthDateRow(ws, 2)
    noteRow = LabelRowOf(ws, "備考")
    If noteRow > 0 Then docRow = noteRow + NOTE_TO_DOC Else docRow = LabelRowOf(ws, "医師数")
    shortRow = LabelRowOf(ws, "過不足")

    Say "■ 解決した位置"
    Say "  日付行        : " & Shown(dateRow)
    Say "  曜日行        : " & Shown(IIf(dateRow > 0, dateRow + 1, 0))
    Say "  医師名欄      : " & Shown(IIf(dateRow > 0, dateRow + 2, 0)) & _
        " 〜 " & Shown(IIf(dateRow > 0, dateRow + 1 + DOC_BLOCK_ROWS, 0))
    Say "  再掲日付行    : " & Shown(repeatRow)
    Say "  備考行        : " & Shown(noteRow)
    Say "  医師数行      : " & Shown(docRow)
    Say "  過不足行      : " & Shown(shortRow)

    If repeatRow > 0 Then gridTop = repeatRow + DATE_REPEAT_GAP
    If docRow > 0 Then gridBottom = docRow - DOC_GAP
    Say "  入力欄        : " & Shown(gridTop) & " 〜 " & Shown(gridBottom) & " 行"
    Say ""

    Say "■ GAS 側の定数との整合"
    problems = problems + Check("医師数行 = 備考行 + " & NOTE_TO_DOC, _
        (noteRow > 0 And docRow = noteRow + NOTE_TO_DOC), _
        "備考行 " & noteRow & " / 医師数行 " & docRow)
    problems = problems + Check("過不足行 = 医師数行 + 2", _
        (shortRow > 0 And shortRow = docRow + 2), _
        "医師数行 " & docRow & " / 過不足行 " & shortRow)
    problems = problems + Check("入力欄の上端 = 再掲日付行 + " & DATE_REPEAT_GAP, _
        (gridTop > 0), "再掲日付行 " & repeatRow)
    problems = problems + Check("入力欄の下端 = 医師数行 - " & DOC_GAP, _
        (gridBottom > 0 And gridBottom >= gridTop), _
        "上端 " & gridTop & " / 下端 " & gridBottom)
    Say ""

    Say "■ 判定"
    If dateRow = 0 Then
        Say "  × 日付行が見つかりません。"
        problems = problems + 1
    End If
    If repeatRow = 0 Then
        Say "  × 再掲日付行（2つ目の日付行）が見つかりません。"
        problems = problems + 1
    End If
    If docRow = 0 Then
        Say "  × A列に「備考」も「医師数」もありません。"
        problems = problems + 1
    End If

    If problems = 0 Then
        Say "  ○ GAS 版はこのシートを読めます。"
    Else
        Say "  => 問題 " & problems & " 件。上の × と NG を見てください。"
        Say ""
        Say "  よくある原因:"
        Say "   ・日付行の「1」「2」が日付ではなく、ただの数値になっている"
        Say "   ・A列の「備考」が別の文字（空欄・全角空白など）になっている"
        Say "   ・日付行が1つしかない（再掲の行が無い）"
        Say "   ・行の間隔が GAS 側の定数と違う（上の整合を参照）"
    End If
    Say ""
End Sub

Private Function Check(ByVal label As String, ByVal ok As Boolean, _
                       ByVal detail As String) As Long
    If ok Then
        Say "  OK  " & label
    Else
        Say "  NG  " & label & "   （実測: " & detail & "）"
        Check = 1
    End If
End Function

Private Function Shown(ByVal n As Long) As String
    Shown = IIf(n > 0, CStr(n), "見つからない")
End Function


'==================================================================
'  列の使われ方
'==================================================================
Private Sub ReportColumns(ByVal ws As Worksheet)
    Dim dateRow As Long, c As Long, days As Long

    dateRow = NthDateRow(ws, 1)
    Say "■ 列の使われ方"
    If dateRow > 0 Then
        For c = COL_FIRST To COL_LAST
            If IsDate(ws.Cells(dateRow, c).Value) Then days = days + 1
        Next c
        Say "  日付が入っている列数（B〜AF）: " & days & " / 31"
        If days < 28 Then Say "  ★ 31列に満たない場合、日付の並びが想定と違う可能性があります。"
    Else
        Say "  日付行が無いため確認できません。"
    End If

    Say "  AG（年月シリアル）: " & DescribeCell(ws.Cells(IIf(dateRow > 1, dateRow - 1, 1), COL_MONTH))
    Say "  AH〜AM（集計列）の見出し行を確認してください。"
    Say ""
    Say "  列幅（ピクセル換算・GAS へ渡す値）"
    Say "    A列  : " & PointsToPixels(ws.Columns(1).Width)
    Say "    B列  : " & PointsToPixels(ws.Columns(COL_FIRST).Width)
    Say "    AH列 : " & PointsToPixels(ws.Columns(COL_AGG_FIRST).Width)
    Say ""
End Sub


'==================================================================
'  位置の解決（GAS 版 Layout.gs と同じ規則）
'==================================================================
Private Function NthDateRow(ByVal ws As Worksheet, ByVal nth As Long) As Long
    Dim r As Long, hit As Long
    For r = 1 To MAX_SCAN_ROWS
        If Not IsEmpty(ws.Cells(r, COL_FIRST).Value) Then
            If IsDate(ws.Cells(r, COL_FIRST).Value) Then
                hit = hit + 1
                If hit = nth Then NthDateRow = r: Exit Function
            End If
        End If
    Next r
End Function

Private Function LabelRowOf(ByVal ws As Worksheet, ByVal label As String) As Long
    Dim r As Long, v As String
    For r = 1 To MAX_SCAN_ROWS
        v = Trim$(CStr(ws.Cells(r, 1).Value))
        If v <> "" Then
            If InStr(1, v, label) = 1 Then LabelRowOf = r: Exit Function
        End If
    Next r
End Function


'==================================================================
'  小道具
'==================================================================
Private Sub Say(ByVal s As String)
    mLines.Add s
End Sub

Private Function ColLetterOf(ByVal colNo As Long) As String
    ColLetterOf = Split(Cells(1, colNo).Address(True, False), "$")(0)
End Function

'--- Excel はポイント、Google Sheets はピクセル（96dpi なので 4/3 倍） ---
Private Function PointsToPixels(ByVal pts As Double) As Long
    PointsToPixels = CLng(Application.Round(pts * 4# / 3#, 0))
End Function

Private Sub WriteOut()
    Dim ws As Worksheet, i As Long

    On Error Resume Next
    Set ws = ThisWorkbook.Worksheets(OUT_SHEET)
    On Error GoTo 0

    If ws Is Nothing Then
        Set ws = ThisWorkbook.Worksheets.Add( _
            After:=ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count))
        ws.Name = OUT_SHEET
    End If

    ws.Cells.Clear
    ws.Columns(1).NumberFormat = "@"
    For i = 1 To mLines.Count
        ws.Cells(i, 1).Value = mLines(i)
    Next i
    ws.Columns(1).ColumnWidth = 90
    ws.Activate
End Sub
