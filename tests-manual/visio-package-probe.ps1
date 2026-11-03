param([Parameter(Mandatory)] [string]$Source, [Parameter(Mandatory)] [string]$Reference, [Parameter(Mandatory)] [string]$Output, [string[]]$Parts)
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path -LiteralPath $Output) { throw 'Probe output already exists.' }
Copy-Item -LiteralPath $Source -Destination $Output
$from = [IO.Compression.ZipFile]::OpenRead($Reference)
$to = [IO.Compression.ZipFile]::Open($Output, [IO.Compression.ZipArchiveMode]::Update)
try {
  foreach ($name in $Parts) {
    $src = $from.GetEntry($name)
    if ($null -eq $src) { throw "Reference lacks $name" }
    $old = $to.GetEntry($name)
    if ($null -ne $old) { $old.Delete() }
    $next = $to.CreateEntry($name)
    $read = $src.Open(); $write = $next.Open()
    try { $read.CopyTo($write) } finally { $write.Dispose(); $read.Dispose() }
  }
} finally { $to.Dispose(); $from.Dispose() }
Write-Output "Created $Output"
