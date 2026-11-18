$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$appDir = Join-Path $root 'dist\win-unpacked'
$exe = Get-ChildItem -LiteralPath $appDir -Filter *.exe |
  Where-Object { $_.Name -notlike 'Uninstall*' } |
  Sort-Object Length -Descending |
  Select-Object -First 1
if (-not $exe) { throw "app exe not found under $appDir" }
$target = $exe.FullName
$workdir = $exe.DirectoryName
$base = $exe.BaseName
$ws = New-Object -ComObject WScript.Shell
$roots = @(
  "$env:USERPROFILE\Desktop",
  "$env:PUBLIC\Desktop",
  "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"
)
$fixed = New-Object System.Collections.Generic.List[string]
foreach ($rootPath in $roots) {
  if (-not (Test-Path -LiteralPath $rootPath)) { continue }
  Get-ChildItem -LiteralPath $rootPath -Filter *.lnk -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $shortcut = $ws.CreateShortcut($_.FullName)
      $match = $false
      if ($shortcut.TargetPath) {
        if ($shortcut.TargetPath -like '*\installed-final\*') { $match = $true }
        if ($shortcut.TargetPath -like "*\$base.exe") { $match = $true }
      }
      if ($_.BaseName -like "*$base*") { $match = $true }
      if ($match) {
        $shortcut.TargetPath = $target
        $shortcut.WorkingDirectory = $workdir
        $shortcut.IconLocation = "$target,0"
        $shortcut.Description = 'SupplyCost Sentinel'
        $shortcut.Save()
        $fixed.Add($_.FullName)
      }
    } catch { }
  }
}
Write-Output "TARGET=$target"
Write-Output "FIXED_COUNT=$($fixed.Count)"
foreach ($path in $fixed) {
  $shortcut = $ws.CreateShortcut($path)
  Write-Output "VERIFY=$path|$($shortcut.TargetPath)|$(Test-Path -LiteralPath $shortcut.TargetPath)"
}
