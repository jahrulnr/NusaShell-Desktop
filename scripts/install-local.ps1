$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $repoRoot 'VERSION') -Raw).Trim()
$buildDir = if ($env:NUSASHELL_BUILD_DIR) {
  [IO.Path]::GetFullPath($env:NUSASHELL_BUILD_DIR)
} else {
  Join-Path $repoRoot 'apps\desktop\out\NusaShell-Desktop-win32-x64'
}
if (-not (Test-Path -LiteralPath $buildDir -PathType Container)) {
  throw "Build output not found at $buildDir. Run make install first or set NUSASHELL_BUILD_DIR."
}

$root = Join-Path $env:LOCALAPPDATA 'Programs\NusaShell-Desktop'
$versions = Join-Path $root 'versions'
$target = Join-Path $versions $version
$current = Join-Path $root 'current'
New-Item -ItemType Directory -Force -Path $versions | Out-Null
if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
New-Item -ItemType Directory -Force -Path $target | Out-Null
Get-ChildItem -LiteralPath $buildDir -Force | Copy-Item -Destination $target -Recurse -Force

if (Test-Path -LiteralPath $current) {
  $currentItem = Get-Item -LiteralPath $current -Force
  if (($currentItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    [IO.Directory]::Delete($current)
  } else {
    Remove-Item -LiteralPath $current -Force
  }
}
New-Item -ItemType Junction -Path $current -Target $target | Out-Null

$shell = New-Object -ComObject WScript.Shell
$iconPath = Join-Path $current 'resources\nusashell.png'
$shortcutPaths = @(
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\NusaShell-Desktop.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'NusaShell-Desktop.lnk')
)
foreach ($shortcutPath in $shortcutPaths) {
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = Join-Path $current 'NusaShell-Desktop.exe'
  $shortcut.WorkingDirectory = $current
  $shortcut.IconLocation = "$(Join-Path $current 'NusaShell-Desktop.exe'),0"
  $shortcut.Save()
}

Get-ChildItem -LiteralPath $versions -Directory |
  Where-Object { $_.Name -ne $version } |
  Remove-Item -Recurse -Force
Write-Host "Installed NusaShell $version from $buildDir."
