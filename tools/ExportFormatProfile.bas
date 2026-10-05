Attribute VB_Name = "ExportFormatProfile"
Option Explicit
'==================================================================
'  GAS 版へ書式を引き渡すためのエクスポータ  v1.0
'
'  Excel のシフト表から書式を読み、GAS 版の「書式プロファイル」と
'  同じ形の JSON を書き出す。
'
'  【なぜ Excel 側で読むのか】
'    Excel ブックを Google スプレッドシートへ取り込むと、条件付き書式の
'    数式や一部の書式が落ちる。落ちたあとを測っても元の見た目は分からない。
'    Excel 側で測れば、変換で失われる前の値が取れる。
'
'  【このファイルの位置づけ】
'    移行用の使い捨てツール。VBA 版のソース（Auto_Shift_Generator/src）には
'    追加しない。GAS 版のリポジトリの tools/ に置き、必要なときに
'    Excel へ取り込んで実行する。
'
'  【使い方】
'    1. シフト表のブックを開く
'    2. VBE（Alt+F11）→ ファイル → ファイルのインポート → このファイル
'    3. シフト表のシートを選んだ状態で GASProfile_書式エクスポート を実行
'    4. 「GAS書式JSON」シートの A1 に出た JSON をコピー
'    5. GAS 側で シフト → 初期設定 → 書式プロファイルを読み込む に貼る
'
'  【氏名は書き出さない】
'    書き出すのは書式と、位置が決まっているラベル（集計行・集計列の見出し）
'    だけ。氏名・医師名・面談日程は対象外。GAS 側の取り込みと同じ方針。
'==================================================================

Private Const OUT_SHEET As String = "GAS書式JSON"
Private Const MAX_SCAN_ROWS As Long = 200

'--- GAS 側 Config.gs の LAYOUT と揃える ---
Private Const COL_FIRST As Long = 2      ' B
Private Const COL_LAST As Long = 32      ' AF
Private Const COL_AGG_FIRST As Long = 34 ' AH
Private Const COL_AGG_LAST As Long = 39  ' AM
Private Const DOC_BLOCK_ROWS As Long = 5
Private Const NOTE_TO_DOC As Long = 2


'==================================================================
'  入口
'==================================================================
Public Sub GASProfile_書式エクスポート()
    On Error GoTo ErrHandler
    Dim ws As Worksheet
    Dim dateRow As Long, repeatRow As Long, noteRow As Long, docRow As Long
    Dim json As String

    Set ws = ActiveSheet

    dateRow = DateFormulaRowOf(ws, 1)
    repeatRow = DateFormulaRowOf(ws, 2)
    noteRow = LabelRowOf(ws, "備考")

    If dateRow = 0 Or repeatRow = 0 Then
        MsgBox "このシートはシフト表として読めませんでした。" & vbCrLf & vbCrLf & _
               "B列に「数式が入っていて値が日付」のセルが2つ必要です。" & vbCrLf & _
               "見つかった数: " & IIf(dateRow = 0, 0, IIf(repeatRow = 0, 1, 2)), _
               vbExclamation
        Exit Sub
    End If
    If noteRow = 0 Then
        MsgBox "A列に「備考」が見つかりませんでした。集計行の位置を決められません。", _
               vbExclamation
        Exit Sub
    End If

    docRow = noteRow + NOTE_TO_DOC
    json = BuildProfileJson(ws, dateRow, repeatRow, noteRow, docRow)
    WriteOut json

    MsgBox "書式を書き出しました。" & vbCrLf & vbCrLf & _
           "「" & OUT_SHEET & "」シートの A1 の中身をすべてコピーして、" & vbCrLf & _
           "GAS 側の「初期設定 → 書式プロファイルを読み込む」に貼ってください。" & vbCrLf & vbCrLf & _
           "※ 氏名・医師名は書き出していません。", vbInformation
    Exit Sub

ErrHandler:
    MsgBox "書き出しに失敗しました。" & vbCrLf & vbCrLf & _
           "Err " & Err.Number & ": " & Err.Description, vbCritical
End Sub


'==================================================================
'  JSON の組み立て
'==================================================================
Private Function BuildProfileJson(ByVal ws As Worksheet, _
                                   ByVal dateRow As Long, ByVal repeatRow As Long, _
                                   ByVal noteRow As Long, ByVal docRow As Long) As String
    Dim parts As Collection
    Dim weekRow As Long, doctorTop As Long, doctorBottom As Long, freeRow As Long
    Dim gridTop As Long

    Set parts = New Collection

    weekRow = dateRow + 1
    doctorTop = weekRow + 1
    doctorBottom = doctorTop + DOC_BLOCK_ROWS - 1
    freeRow = doctorBottom + 1
    gridTop = repeatRow + 1

    '--- 役割ごとの書式。代表セルは日付列の先頭（B列） ---
    AddRole parts, ws, "header", dateRow - 1
    AddRole parts, ws, "date", dateRow
    AddRole parts, ws, "week", weekRow
    AddRole parts, ws, "doctor", doctorTop
    AddRole parts, ws, "free", freeRow
    AddRole parts, ws, "repeatDate", repeatRow
    AddRole parts, ws, "grid", gridTop
    AddRole parts, ws, "note", noteRow
    AddRole parts, ws, "total", docRow

    '--- 列幅。Excel は「ポイント」、Sheets は「ピクセル」なので換算する ---
    parts.Add NumPair("col.name.width", PointsToPixels(ws.Columns(1).Width))
    parts.Add NumPair("col.day.width", PointsToPixels(ws.Columns(COL_FIRST).Width))
    parts.Add NumPair("col.agg.width", PointsToPixels(ws.Columns(COL_AGG_FIRST).Width))

    '--- 曜日ごとの色。まずセルの塗り、無ければ条件付き書式から拾う ---
    AddDayColors parts, ws, dateRow

    '--- ラベル（位置が決まっているものだけ） ---
    parts.Add StrPair("label.doc", CStr(ws.Cells(docRow, 1).Value))
    parts.Add StrPair("label.pharm", CStr(ws.Cells(docRow + 1, 1).Value))
    parts.Add StrPair("label.shortage", CStr(ws.Cells(docRow + 2, 1).Value))
    parts.Add StrPair("label.note", CStr(ws.Cells(noteRow, 1).Value))
    parts.Add StrPair("label.agg", AggHeads(ws, repeatRow))

    '--- 条件付き書式の一覧。GAS 側が色を拾い、残りは控えとして見せる ---
    parts.Add """_conditionalFormats"":" & ConditionalFormatsJson(ws, dateRow)

    ' 表示形式そのものは書き出さない。Excel の和暦書式（[$-ja-JP]ge"." m"月"）は
    ' Sheets に無く、そのまま渡すと壊れる（仕様書 §5.2）。
    ' ただし「元が何だったか」は控えとして渡す。GAS 側は和暦の見出しを
    ' 数式（title.formula）で組むので、その調整に使う。
    parts.Add StrPair("_excelMonthFormat", ws.Cells(dateRow - 1, 1).NumberFormatLocal)

    BuildProfileJson = "{" & JoinCollection(parts, ",") & "}"
End Function


'--- 役割ひとつ分の書式を足す ---
Private Sub AddRole(ByRef parts As Collection, ByVal ws As Worksheet, _
                    ByVal role As String, ByVal rowNo As Long)
    Dim c As Range
    Set c = ws.Cells(rowNo, COL_FIRST)

    parts.Add NumPair("role." & role & ".height", PointsToPixels(ws.Rows(rowNo).RowHeight))
    parts.Add StrPair("role." & role & ".bg", FillColorOf(c))
    parts.Add StrPair("role." & role & ".fontColor", FontColorOf(c))
    parts.Add NumPair("role." & role & ".fontSize", CLng(c.Font.Size))
    parts.Add BoolPair("role." & role & ".bold", c.Font.Bold = True)
    parts.Add StrPair("role." & role & ".hAlign", HAlignOf(c))
End Sub


'--- 土曜・日曜・月外の色 ---
Private Sub AddDayColors(ByRef parts As Collection, ByVal ws As Worksheet, _
                         ByVal dateRow As Long)
    Dim j As Long, v As Variant
    Dim satBg As String, sunBg As String, outBg As String, outFg As String
    Dim monthValue As Variant

    monthValue = ws.Cells(dateRow - 1, 1).Value

    For j = COL_FIRST To COL_LAST
        v = ws.Cells(dateRow, j).Value
        If IsDate(v) Then
            If IsDate(monthValue) And Month(v) <> Month(monthValue) Then
                If outBg = "" Then
                    outBg = FillColorOf(ws.Cells(dateRow, j))
                    outFg = FontColorOf(ws.Cells(dateRow, j))
                End If
            ElseIf Weekday(v, vbSunday) = 7 And satBg = "" Then
                satBg = FillColorOf(ws.Cells(dateRow, j))
            ElseIf Weekday(v, vbSunday) = 1 And sunBg = "" Then
                sunBg = FillColorOf(ws.Cells(dateRow, j))
            End If
        End If
    Next j

    parts.Add StrPair("day.satBg", satBg)
    parts.Add StrPair("day.sunBg", sunBg)
    parts.Add StrPair("day.outMonthBg", outBg)
    parts.Add StrPair("day.outMonthFg", outFg)
End Sub


'--- 条件付き書式を JSON の配列にする ---
'    GAS 側の deriveDayColorsFromRules_ が数式から色を拾えるよう、
'    formula と bg を同じ名前で渡す。
Private Function ConditionalFormatsJson(ByVal ws As Worksheet, ByVal dateRow As Long) As String
    Dim items As Collection
    Dim fc As Object
    Dim i As Long
    Dim formula As String, bg As String, fg As String

    Set items = New Collection

    On Error Resume Next   ' 条件付き書式が無いシートでも止めない
    For i = 1 To ws.Cells.FormatConditions.Count
        Set fc = ws.Cells.FormatConditions(i)
        formula = ""
        bg = ""
        fg = ""

        If fc.Type = 2 Then formula = CStr(fc.Formula1)   ' 2 = xlExpression
        bg = LongToHex(fc.Interior.Color)
        fg = LongToHex(fc.Font.Color)

        items.Add "{""index"":" & i & _
                  ",""kind"":""" & EscapeJson(TypeName(fc)) & """" & _
                  ",""formula"":""" & EscapeJson(formula) & """" & _
                  ",""bg"":""" & EscapeJson(bg) & """" & _
                  ",""fontColor"":""" & EscapeJson(fg) & """" & _
                  ",""ranges"":""" & EscapeJson(fc.AppliesTo.Address(False, False)) & """}"
    Next i
    On Error GoTo 0

    ConditionalFormatsJson = "[" & JoinCollection(items, ",") & "]"
End Function


'--- 集計列の見出しをカンマ区切りで ---
Private Function AggHeads(ByVal ws As Worksheet, ByVal headRow As Long) As String
    Dim j As Long, s As String
    For j = COL_AGG_FIRST To COL_AGG_LAST
        If s <> "" Then s = s & ","
        s = s & Trim$(CStr(ws.Cells(headRow, j).Value))
    Next j
    AggHeads = s
End Function


'==================================================================
'  位置の解決（GAS 版 Layout.gs と同じ規則）
'==================================================================
Private Function DateFormulaRowOf(ByVal ws As Worksheet, ByVal nth As Long) As Long
    Dim r As Long, hit As Long
    For r = 1 To MAX_SCAN_ROWS
        With ws.Cells(r, COL_FIRST)
            If .HasFormula And IsDate(.Value) Then
                hit = hit + 1
                If hit = nth Then
                    DateFormulaRowOf = r
                    Exit Function
                End If
            End If
        End With
    Next r
End Function

Private Function LabelRowOf(ByVal ws As Worksheet, ByVal label As String) As Long
    Dim r As Long, v As String
    For r = 1 To MAX_SCAN_ROWS
        v = Trim$(CStr(ws.Cells(r, 1).Value))
        If v <> "" Then
            If InStr(1, v, label) = 1 Then
                LabelRowOf = r
                Exit Function
            End If
        End If
    Next r
End Function


'==================================================================
'  単位と色の変換（ここを間違えると静かに違う見た目になる）
'==================================================================

'--- Excel はポイント、Google Sheets はピクセル（96dpi なので 4/3 倍） ---
Private Function PointsToPixels(ByVal pts As Double) As Long
    PointsToPixels = CLng(Application.Round(pts * 4# / 3#, 0))
End Function

'--- Excel の色は BGR の Long。Sheets は #RRGGBB ---
Private Function LongToHex(ByVal c As Variant) As String
    Dim n As Long
    If IsNull(c) Or IsEmpty(c) Then Exit Function
    On Error Resume Next
    n = CLng(c)
    If Err.Number <> 0 Then
        Err.Clear
        Exit Function
    End If
    On Error GoTo 0

    LongToHex = "#" & Right$("0" & Hex$(n Mod 256), 2) & _
                      Right$("0" & Hex$((n \ 256) Mod 256), 2) & _
                      Right$("0" & Hex$((n \ 65536) Mod 256), 2)
End Function

'--- 塗りつぶし。塗っていなければ空文字（GAS 側が既定値に落とす） ---
Private Function FillColorOf(ByVal c As Range) As String
    If c.Interior.Pattern = xlNone Then Exit Function
    FillColorOf = LongToHex(c.Interior.Color)
End Function

'--- 文字色。自動なら黒 ---
Private Function FontColorOf(ByVal c As Range) As String
    If c.Font.ColorIndex = xlAutomatic Then
        FontColorOf = "#000000"
    Else
        FontColorOf = LongToHex(c.Font.Color)
    End If
End Function

'--- 横位置。Sheets が受ける語に寄せる。既定は GAS 側で正規化される ---
Private Function HAlignOf(ByVal c As Range) As String
    Select Case c.HorizontalAlignment
        Case xlLeft: HAlignOf = "left"
        Case xlCenter, xlCenterAcrossSelection: HAlignOf = "center"
        Case xlRight: HAlignOf = "right"
        Case Else: HAlignOf = "general"
    End Select
End Function


'==================================================================
'  JSON の小道具（VBA に JSON ライブラリが無いので手で組む）
'==================================================================
Private Function StrPair(ByVal key As String, ByVal value As String) As String
    StrPair = """" & EscapeJson(key) & """:""" & EscapeJson(value) & """"
End Function

Private Function NumPair(ByVal key As String, ByVal value As Long) As String
    NumPair = """" & EscapeJson(key) & """:" & CStr(value)
End Function

Private Function BoolPair(ByVal key As String, ByVal value As Boolean) As String
    BoolPair = """" & EscapeJson(key) & """:" & IIf(value, "true", "false")
End Function

'--- 条件付き書式の数式には " が入るので、必ず通すこと ---
Private Function EscapeJson(ByVal s As String) As String
    Dim t As String
    t = Replace$(s, "\", "\\")
    t = Replace$(t, """", "\""")
    t = Replace$(t, vbCrLf, "\n")
    t = Replace$(t, vbCr, "\n")
    t = Replace$(t, vbLf, "\n")
    t = Replace$(t, vbTab, "\t")
    EscapeJson = t
End Function

Private Function JoinCollection(ByVal items As Collection, ByVal sep As String) As String
    Dim i As Long, s As String
    For i = 1 To items.Count
        If i > 1 Then s = s & sep
        s = s & items(i)
    Next i
    JoinCollection = s
End Function


'--- 出力先のシートへ書く ---
Private Sub WriteOut(ByVal json As String)
    Dim ws As Worksheet

    On Error Resume Next
    Set ws = ThisWorkbook.Worksheets(OUT_SHEET)
    On Error GoTo 0

    If ws Is Nothing Then
        Set ws = ThisWorkbook.Worksheets.Add(After:=ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count))
        ws.Name = OUT_SHEET
    End If

    ws.Cells.Clear
    ws.Range("A1").NumberFormat = "@"
    ws.Range("A1").Value = json
    ws.Range("A2").Value = "↑ この A1 の中身をすべてコピーして、GAS 側の" & _
                           "「初期設定 → 書式プロファイルを読み込む」に貼ってください"
    ws.Range("A3").Value = "書き出し日時: " & Format$(Now, "yyyy/mm/dd hh:nn:ss")
    ws.Columns(1).ColumnWidth = 100
    ws.Activate
End Sub
