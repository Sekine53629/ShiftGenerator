# シフト作成ツール（ShiftGrid.html）をこの PC に置く。
#
#   1. ドキュメントに ShiftGenerator フォルダと、その下の data フォルダを作る
#   2. HTML を ShiftGenerator\ShiftGenerator.html として置く（上書き）。元は、配布の zip なら
#      このスクリプトの隣の ShiftGenerator.html、リポジトリなら prototype\ShiftGrid.html
#   3. デスクトップに「シフト作成」のショートカットを作る（Edge で開く）
#
# **data フォルダの中身（マスタ・シフト）には触らない。** HTML を新しくしたいときも、
# これをもう一度実行するだけでよい。
#
# 初めて開いたときは、画面の「保存先フォルダを選ぶ（初回だけ）」で
# ドキュメント\ShiftGenerator を選ぶ。以降は data\db.json（マスタ）と
# data\cells\yyyy-mm.json（シフト。月ごと）に保存される。
#
# **いつも使っているブラウザで開くこと。** データはブラウザごとに別なので、
# 別のブラウザで開くと、前の版で入れたマスタ・シフトが空に見える（消えてはいない）。
#
# 使い方（このフォルダで）:
#   powershell -ExecutionPolicy Bypass -File .\install-local.ps1
#   powershell -ExecutionPolicy Bypass -File .\install-local.ps1 -Dest D:\Shift   （置き場所を変える）
#   powershell -ExecutionPolicy Bypass -File .\install-local.ps1 -Browser Chrome  （Chrome で開く）

param(
    [string]$Dest = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'ShiftGenerator'),
    [ValidateSet('Edge', 'Chrome')]
    [string]$Browser = 'Edge',
    [switch]$NoShortcut
)

$ErrorActionPreference = 'Stop'

# 置くもの・置き場所の名前（ここ以外に書かない）
# 元の HTML は、配布の zip ではこのスクリプトと同じフォルダ、リポジトリでは prototype\ にある
$HtmlName     = 'ShiftGenerator.html'
$SourceCandidates = @((Join-Path $PSScriptRoot $HtmlName),
                      (Join-Path $PSScriptRoot '..\prototype\ShiftGrid.html'))
$SourceHtml   = $SourceCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
$DataDirName  = 'data'
$ShortcutName = 'シフト作成.lnk'
$BrowserPathsByName = @{
    Edge   = @((Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
               (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'))
    Chrome = @((Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
               (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
               (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'))
}
$BrowserPaths = $BrowserPathsByName[$Browser]

function Write-Log([string]$Level, [string]$Message) {
    $line = '{0} [{1}] install-local: {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    if ($Level -eq 'ERROR') { Write-Host $line -ForegroundColor Red } else { Write-Host $line }
}

try {
    if (-not $SourceHtml) {
        throw ("元の HTML が見つかりません: " + ($SourceCandidates -join ' / '))
    }

    $dataDir = Join-Path $Dest $DataDirName
    New-Item -ItemType Directory -Force -Path $Dest | Out-Null
    New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
    Write-Log 'INFO' "フォルダ: $Dest（データは $dataDir）"

    $htmlPath = Join-Path $Dest $HtmlName
    # 置き場所のフォルダの中で実行したときは、元と置き先が同じファイル。写さない
    if ((Resolve-Path -LiteralPath $SourceHtml).Path -eq (Resolve-Path -LiteralPath $Dest).Path.TrimEnd('\') + '\' + $HtmlName) {
        Write-Log 'INFO' "HTML はすでに置き場所にあります: $htmlPath"
    } else {
        Copy-Item -LiteralPath $SourceHtml -Destination $htmlPath -Force
        Write-Log 'INFO' "HTML を置きました: $htmlPath"
    }

    $dataFiles = @(Get-ChildItem -LiteralPath $dataDir -File -ErrorAction SilentlyContinue)
    if ($dataFiles.Count) {
        Write-Log 'INFO' ("data の中身はそのままです（{0} ファイル）" -f $dataFiles.Count)
    } else {
        Write-Log 'INFO' 'data は空です。初めて開いたときに「保存先フォルダを選ぶ」でこのフォルダを選んでください'
    }

    if (-not $NoShortcut) {
        $browser = $BrowserPaths | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
        $lnkPath = Join-Path ([Environment]::GetFolderPath('Desktop')) $ShortcutName
        $shell = New-Object -ComObject WScript.Shell
        $lnk = $shell.CreateShortcut($lnkPath)
        if ($browser) {
            # 保存先フォルダの機能（File System Access API）は Edge と Chrome だけで動く
            $lnk.TargetPath = $browser
            $lnk.Arguments  = '"' + $htmlPath + '"'
        } else {
            Write-Log 'WARN' ($Browser + ' が見つかりません。既定のブラウザで開くショートカットにします（いつもと違うブラウザだと、前のデータが空に見えます）')
            $lnk.TargetPath = $htmlPath
        }
        $lnk.WorkingDirectory = $Dest
        $lnk.Description = 'シフト作成ツール'
        $lnk.Save()
        Write-Log 'INFO' "ショートカット: $lnkPath"
    }

    Write-Log 'INFO' '完了'
    exit 0
} catch {
    Write-Log 'ERROR' ("{0}`n{1}" -f $_.Exception.Message, $_.ScriptStackTrace)
    exit 1
}
