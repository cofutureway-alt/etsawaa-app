$root = 'H:\z etsawaa\etsawaa-app'
$tmp = Join-Path $root 'evidence\_zipstage'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Path $tmp | Out-Null
Copy-Item (Join-Path $root 'evidence\phase-02') (Join-Path $tmp 'phase-02') -Recurse
$ct = Join-Path $tmp 'phase-02\commit.txt'
if (Test-Path $ct) { Remove-Item $ct -Force }
$zip = Join-Path $root 'evidence\phase-02.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $tmp 'phase-02') -DestinationPath $zip
Remove-Item $tmp -Recurse -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$a = [System.IO.Compression.ZipFile]::OpenRead($zip)
$names = $a.Entries.FullName -join "`n"
$count = $a.Entries.Count
$a.Dispose()
if ($names -match 'commit\.txt') { Write-Output 'FAIL: commit.txt still inside zip'; exit 1 }
if ($names -match '_zipstage') { Write-Output 'FAIL: _zipstage root'; exit 1 }
Write-Output "OK: zip rebuilt, $count entries, root=phase-02, no commit.txt"
