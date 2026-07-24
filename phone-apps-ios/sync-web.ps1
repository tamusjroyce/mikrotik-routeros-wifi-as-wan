$source = Join-Path $PSScriptRoot "..\phone-apps\web"
$target = Join-Path $PSScriptRoot "Web"
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -Path (Join-Path $source "*") -Destination $target -Recurse -Force
