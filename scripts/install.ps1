$ErrorActionPreference = 'Stop'
$repo = if ($env:NUSASHELL_REPOSITORY) { $env:NUSASHELL_REPOSITORY } else { 'jahrulnr/NusaShell' }
$base = if ($env:NUSASHELL_RELEASE_BASE) { $env:NUSASHELL_RELEASE_BASE } else { "https://github.com/$repo/releases" }
$manifestUrl = if ($env:NUSASHELL_VERSION) { "$base/download/v$($env:NUSASHELL_VERSION)/latest.json" } else { "$base/latest/download/latest.json" }
$temp = Join-Path ([IO.Path]::GetTempPath()) ("nusashell-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force $temp | Out-Null
try {
  Invoke-WebRequest $manifestUrl -OutFile "$temp/latest.json"
  $manifest = Get-Content "$temp/latest.json" -Raw | ConvertFrom-Json
  $entry = $manifest.files.'win32-x64'
  if (-not $entry) { throw 'No Windows x64 payload is published for this release.' }
  $archive = Join-Path $temp $entry.name
  Invoke-WebRequest "$base/download/v$($manifest.version)/$($entry.name)" -OutFile $archive
  if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLower() -ne $entry.sha256.ToLower()) { throw 'Checksum verification failed; refusing to install.' }
  $root = Join-Path $env:LOCALAPPDATA 'Programs\NusaShell-Desktop'; $versions = Join-Path $root 'versions'; $target = Join-Path $versions $manifest.version
  New-Item -ItemType Directory -Force $versions | Out-Null
  $current = Join-Path $root 'current'; $previousVersion = ''
  if (Test-Path $current) {
    $currentItem = Get-Item -LiteralPath $current -Force
    $currentTarget = [string]$currentItem.Target
    if ($currentTarget) { $previousVersion = Split-Path $currentTarget.TrimEnd('\') -Leaf }
  }
  if (-not (Test-Path $target)) { Expand-Archive $archive -DestinationPath $target; $child = Get-ChildItem $target | Select-Object -First 1; if ($child -and $child.PSIsContainer) { Get-ChildItem $child.FullName | Move-Item -Destination $target; Remove-Item $child.FullName } }
  if (Test-Path $current) { Remove-Item $current -Force }; New-Item -ItemType Junction -Path $current -Target $target | Out-Null
  Get-ChildItem $versions -Directory | Where-Object { $_.Name -ne $manifest.version -and $_.Name -ne $previousVersion } | Remove-Item -Recurse -Force
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
  Write-Host "Installed NusaShell $($manifest.version)."

  # MCP plugins are optional (explicit opt-in; default: none).
  if ($env:NUSASHELL_INSTALL_PLUGINS -in @('1','yes','y','true')) {
    $pluginRepo = if ($env:NUSASHELL_MCP_REPO) { $env:NUSASHELL_MCP_REPO } else { 'https://github.com/jahrulnr/NusaShell-mcp/archive/refs/heads/master.tar.gz' }
    $pluginDest = Join-Path (Join-Path $env:LOCALAPPDATA 'Programs\NusaShell-Desktop') 'plugins'
    Write-Host 'Installing bundled MCP plugins (Files/Terminal/Notes/Kanban)...'
    try {
      $pluginTemp = Join-Path ([IO.Path]::GetTempPath()) ('nusashell-plugins-' + [guid]::NewGuid())
      New-Item -ItemType Directory -Force $pluginTemp | Out-Null
      $pluginArchive = Join-Path $pluginTemp 'plugins.tar.gz'
      Invoke-WebRequest $pluginRepo -OutFile $pluginArchive
      Expand-Archive $pluginArchive -DestinationPath (Join-Path $pluginTemp 'src')
      Get-ChildItem (Join-Path $pluginTemp 'src') | ForEach-Object {
        if ((Test-Path (Join-Path $_.FullName 'manifest.json')) -and (Test-Path (Join-Path $_.FullName 'mcp'))) {
          $targetDir = Join-Path $pluginDest $_.Name
          if (Test-Path $targetDir) { Remove-Item $targetDir -Recurse -Force }
          Copy-Item $_.FullName $targetDir -Recurse -Force
          Write-Host "Installed plugin: $($_.Name)"
        }
      }
    } finally { Remove-Item $pluginTemp -Recurse -Force -ErrorAction SilentlyContinue }
  }
} finally { Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue }
