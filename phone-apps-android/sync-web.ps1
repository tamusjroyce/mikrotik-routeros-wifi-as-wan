$source = Join-Path $PSScriptRoot "..\phone-apps\web"
$target = Join-Path $PSScriptRoot "app\src\main\assets\web"
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -Path (Join-Path $source "*") -Destination $target -Recurse -Force
