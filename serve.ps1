$port = 3456
$root = $PSScriptRoot
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Serving $root on http://localhost:$port"

$mime = @{
  '.html'        = 'text/html; charset=utf-8'
  '.css'         = 'text/css; charset=utf-8'
  '.js'          = 'application/javascript; charset=utf-8'
  '.mjs'         = 'application/javascript; charset=utf-8'
  '.json'        = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'
  '.svg'         = 'image/svg+xml'
  '.png'         = 'image/png'
  '.jpg'         = 'image/jpeg'
  '.ico'         = 'image/x-icon'
  '.csv'         = 'text/csv; charset=utf-8'
}

while ($listener.IsListening) {
  $ctx  = $listener.GetContext()
  $req  = $ctx.Request
  $resp = $ctx.Response
  $path = $req.Url.LocalPath -replace '/', [IO.Path]::DirectorySeparatorChar
  if ($path -eq '\' -or $path -eq '/') { $path = '\index.html' }
  $file = Join-Path $root $path.TrimStart('\/')
  if (Test-Path $file -PathType Leaf) {
    $ext  = [IO.Path]::GetExtension($file)
    $ct   = if ($mime[$ext]) { $mime[$ext] } else { 'application/octet-stream' }
    $bytes = [IO.File]::ReadAllBytes($file)
    $resp.ContentType = $ct
    $resp.ContentLength64 = $bytes.Length
    $resp.OutputStream.Write($bytes, 0, $bytes.Length)
  } else {
    $resp.StatusCode = 404
  }
  $resp.OutputStream.Close()
}
