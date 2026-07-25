[CmdletBinding()]
param(
    [switch]$Check
)

$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourcePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'skills'))
$claudePath = Join-Path $repoRoot '.claude'
$junctionPath = Join-Path $claudePath 'skills'

if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) {
    throw "Skill 源目录不存在：$sourcePath"
}

if (Test-Path -LiteralPath $junctionPath) {
    $item = Get-Item -Force -LiteralPath $junctionPath
    if ($item.LinkType -ne 'Junction') {
        throw "拒绝覆盖普通目录或文件：$junctionPath"
    }

    $targetPath = [System.IO.Path]::GetFullPath([string]$item.Target)
    if ($Check) {
        if ($targetPath -ne $sourcePath) {
            throw "Junction 指向错误：$targetPath；期望：$sourcePath"
        }
        Write-Output "Skill 兼容入口有效：$junctionPath -> $sourcePath"
        exit 0
    }

    [System.IO.Directory]::Delete($junctionPath, $false)
}
elseif ($Check) {
    throw "Skill 兼容入口不存在：$junctionPath"
}

if (-not (Test-Path -LiteralPath $claudePath -PathType Container)) {
    New-Item -ItemType Directory -Path $claudePath | Out-Null
}

New-Item -ItemType Junction -Path $junctionPath -Target $sourcePath | Out-Null
Write-Output "已重新生成 Skill 兼容入口：$junctionPath -> $sourcePath"
