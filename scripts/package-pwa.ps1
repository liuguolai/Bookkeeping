$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $repoRoot
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'PWA build failed' }
  $version = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
  New-Item -ItemType Directory -Path 'artifacts' -Force | Out-Null
  $archive = Join-Path $repoRoot "artifacts\pocket-ledger-$version-pwa.zip"
  $items = (Get-ChildItem -LiteralPath (Join-Path $repoRoot 'dist')).FullName
  Compress-Archive -LiteralPath $items -DestinationPath $archive -Force
  $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
  Set-Content -LiteralPath "$archive.sha256" -Value "$hash  pocket-ledger-$version-pwa.zip" -Encoding ascii
  Write-Output $archive
  Write-Output "SHA256 $hash"
} finally { Pop-Location }
