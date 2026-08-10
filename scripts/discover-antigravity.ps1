# Locates Antigravity's language servers and the Connect API they listen on.
#
# The bundled `antigravity-usage` CLI cannot do this reliably: its process scoring
# picks the Electron shell, which owns no sockets, so local mode always fails.
# Each language server carries its own --csrf_token on its command line, which is
# more current than the copy in main.log.

$ErrorActionPreference = 'SilentlyContinue'

$servers = @()

Get-CimInstance Win32_Process -Filter "Name like 'language_server%'" | ForEach-Object {
  if ($_.CommandLine -match '--csrf_token\s+(\S+)') {
    $token = $matches[1]
    $ports = @(
      Get-NetTCPConnection -State Listen -OwningProcess $_.ProcessId |
        Select-Object -ExpandProperty LocalPort
    )
    if ($ports.Count -gt 0) {
      $servers += [pscustomobject]@{ csrf = $token; ports = $ports }
    }
  }
}

# Always emit an array so the caller never has to special-case a single result.
ConvertTo-Json -InputObject @($servers) -Compress -Depth 4
