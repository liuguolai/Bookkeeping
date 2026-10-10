param(
  [string]$SdkPath = 'D:\Android\Sdk',
  [string]$JavaHome = '',
  [string]$GradleHome = '',
  [string]$InitScript = '',
  [string]$DebugKeystore = ''
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $repoRoot
try {
  if (-not (Test-Path -LiteralPath $SdkPath)) { throw "Android SDK missing: $SdkPath" }
  if (-not $JavaHome) {
    $portableJdk = Join-Path $repoRoot '.local\tools\jdk21'
    if (Test-Path -LiteralPath $portableJdk) { $JavaHome = (Get-ChildItem -LiteralPath $portableJdk -Directory | Select-Object -First 1).FullName }
    else { $JavaHome = $env:JAVA_HOME }
  }
  if (-not $JavaHome -or -not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin\java.exe'))) { throw 'Set -JavaHome to a JDK 21 installation.' }
  $env:JAVA_HOME = $JavaHome
  $env:ANDROID_HOME = $SdkPath
  $env:GRADLE_USER_HOME = Join-Path $repoRoot '.local\gradle'
  $sdkValue = 'sdk.dir=' + $SdkPath.Replace('\','/')
  Set-Content -LiteralPath 'android\local.properties' -Value $sdkValue -Encoding ascii
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'Web build failed' }
  & npx.cmd cap sync android
  if ($LASTEXITCODE -ne 0) { throw 'Capacitor sync failed' }
  $gradleArgs = @('-p', 'android', 'assembleDebug', '--no-daemon', '--console=plain', '--max-workers=4')
  if ($InitScript) { $gradleArgs += @('--init-script', (Resolve-Path -LiteralPath $InitScript).Path) }
  if ($GradleHome) { & (Join-Path $GradleHome 'bin\gradle.bat') @gradleArgs }
  else { & '.\android\gradlew.bat' @gradleArgs }
  if ($LASTEXITCODE -ne 0) { throw 'Android build failed' }
  New-Item -ItemType Directory -Path 'artifacts' -Force | Out-Null
  $appVersion = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
  $artifactPath = "artifacts\pocket-ledger-$appVersion-debug.apk"
  Copy-Item -LiteralPath 'android\app\build\outputs\apk\debug\app-debug.apk' -Destination $artifactPath -Force
  if ($DebugKeystore) {
    $signer = Get-ChildItem -LiteralPath (Join-Path $SdkPath 'build-tools') -Directory |
      Sort-Object Name -Descending | Select-Object -First 1
    & (Join-Path $JavaHome 'bin\java.exe') -jar (Join-Path $signer.FullName 'lib\apksigner.jar') sign --ks (Resolve-Path -LiteralPath $DebugKeystore).Path --ks-pass pass:android --key-pass pass:android $artifactPath
    if ($LASTEXITCODE -ne 0) { throw 'Debug APK signing failed' }
  }
  Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256
} finally { Pop-Location }
