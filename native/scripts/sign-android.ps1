param([ValidateSet('upload','debug')][string]$Kind='upload')
$ErrorActionPreference='Stop'
$nativeRoot=Split-Path -Parent $PSScriptRoot
$repoRoot=Split-Path -Parent $nativeRoot
$keyRoot=Join-Path $env:USERPROFILE '.android\jokers-run-signing'
$credential=Import-Clixml -LiteralPath (Join-Path $keyRoot "$Kind-password.xml")
$env:POLELINE_SIGN_PASS=[System.Net.NetworkCredential]::new('', $credential).Password
try {
    $keyFile=Join-Path $keyRoot "$Kind.jks"
    $alias="jokers-run-$Kind"
    $outputDir=Join-Path $repoRoot 'release-artifacts'
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
    if($Kind -eq 'upload') {
        $bundle=Join-Path $outputDir 'poleline-1.0.0-upload-signed.aab'
        Copy-Item -LiteralPath (Join-Path $nativeRoot 'android\app\build\outputs\bundle\release\app-release.aab') -Destination $bundle -Force
        & "$env:JAVA_HOME\bin\jarsigner.exe" -keystore $keyFile -storepass:env POLELINE_SIGN_PASS -keypass:env POLELINE_SIGN_PASS -sigalg SHA256withRSA -digestalg SHA-256 $bundle $alias
        if($LASTEXITCODE -ne 0){throw 'Bundle signing failed'}
        $apk=Join-Path $nativeRoot 'android\app\build\outputs\apk\release\app-release-unsigned.apk'
    } else { $apk=Join-Path $nativeRoot 'android\app\build\outputs\apk\debug\app-debug-unsigned.apk' }
    $outputApk=Join-Path $outputDir "poleline-1.0.0-$Kind-signed.apk"
    & "$env:ANDROID_HOME\build-tools\36.0.0\apksigner.bat" sign --ks $keyFile --ks-key-alias $alias --ks-pass env:POLELINE_SIGN_PASS --key-pass env:POLELINE_SIGN_PASS --out $outputApk $apk
    if($LASTEXITCODE -ne 0){throw 'APK signing failed'}
    & "$env:ANDROID_HOME\build-tools\36.0.0\apksigner.bat" verify --verbose --print-certs $outputApk
    if($LASTEXITCODE -ne 0){throw 'APK verification failed'}
} finally {Remove-Item Env:POLELINE_SIGN_PASS -ErrorAction SilentlyContinue}
