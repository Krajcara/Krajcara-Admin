'use strict';
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const https = require('https');

const AGENT_INSECURE = new https.Agent({ rejectUnauthorized: false });

const WSA   = 'http://schemas.xmlsoap.org/ws/2004/08/addressing';
const WSMAN = 'http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd';
const RSP   = 'http://schemas.microsoft.com/wbem/wsman/1/windows/shell';
const RES   = 'http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd';

// ── SOAP envelope builder ─────────────────────────────────────────────────────
function soap(action, headerExtra, body, timeoutSec) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:wsa="${WSA}" xmlns:wsman="${WSMAN}" xmlns:rsp="${RSP}">
  <s:Header>
    <wsa:To>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:To>
    <wsman:ResourceURI s:mustUnderstand="true">${RES}</wsman:ResourceURI>
    <wsa:ReplyTo><wsa:Address s:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address></wsa:ReplyTo>
    <wsa:Action s:mustUnderstand="true">${action}</wsa:Action>
    <wsman:OperationTimeout>PT${timeoutSec}.000S</wsman:OperationTimeout>
    <wsa:MessageID>uuid:${uuidv4()}</wsa:MessageID>
    ${headerExtra}
  </s:Header>
  <s:Body>${body}</s:Body>
</s:Envelope>`;
}

// ── Parse tag value from XML ──────────────────────────────────────────────────
function parseTag(xml, tag) {
  const m = xml.match(new RegExp(`<[^>]*${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^>]*>([^<]+)<`));
  return m ? m[1] : null;
}

// ── Decode stream output from SOAP receive response ───────────────────────────
function parseStreams(xml) {
  const decodeStream = name => {
    const pattern = new RegExp(`<rsp:Stream Name="${name}"[^>]*>([^<]*)</rsp:Stream>`, 'g');
    let result = '', match;
    while ((match = pattern.exec(xml)) !== null) {
      if (match[1]) result += Buffer.from(match[1], 'base64').toString('utf8');
    }
    return result;
  };
  const ecMatch = xml.match(/ExitCode>(\d+)/);
  return {
    stdout:   decodeStream('stdout'),
    stderr:   decodeStream('stderr'),
    exitCode: ecMatch ? parseInt(ecMatch[1]) : null,
    done:     xml.includes('CommandState') && xml.includes('Done'),
  };
}

// ── HTTP POST to WinRM endpoint ───────────────────────────────────────────────
async function winrmPost(server, body, timeoutMs = 30000) {
  const useHttps = !!server.winrm_https;
  const port     = server.winrm_port || (useHttps ? 5986 : 5985);
  const url      = `${useHttps ? 'https' : 'http'}://${server.ip_address}:${port}/wsman`;
  const user     = server.winrm_user;
  const pass     = server.winrm_password;
  const auth     = Buffer.from(`${user}:${pass}`).toString('base64');

  const r = await axios.post(url, body, {
    headers: {
      'Content-Type': 'application/soap+xml;charset=UTF-8',
      'Authorization': `Basic ${auth}`,
    },
    httpsAgent: AGENT_INSECURE,
    timeout:    timeoutMs,
    validateStatus: s => s < 500,
  });

  if (r.status >= 400) throw new Error(`WinRM HTTP ${r.status}: ${r.data?.toString()?.slice(0, 200) || ''}`);
  return r.data;
}

// ── Execute PowerShell script via WinRM ───────────────────────────────────────
async function executeScript(server, script, timeoutSec = 60) {
  const start = Date.now();
  let shellId = null;

  // Encode PS script as Base64 UTF-16LE
  const encoded = Buffer.from(script, 'utf16le').toString('base64');

  try {
    // 1. Create shell
    const createResp = await winrmPost(server, soap(
      'http://schemas.xmlsoap.org/ws/2004/09/transfer/Create', '',
      '<rsp:Shell><rsp:InputStreams>stdin</rsp:InputStreams><rsp:OutputStreams>stdout stderr</rsp:OutputStreams></rsp:Shell>',
      timeoutSec
    ), timeoutSec * 1000 + 5000);

    shellId = parseTag(createResp, 'ShellId');
    if (!shellId) throw new Error('Failed to open WinRM shell');

    const sel = `<wsman:SelectorSet><wsman:Selector Name="ShellId">${shellId}</wsman:Selector></wsman:SelectorSet>`;

    // 2. Send command
    const cmdResp = await winrmPost(server, soap(
      'http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Command', sel,
      `<rsp:CommandLine><rsp:Command>powershell.exe</rsp:Command><rsp:Arguments>-NonInteractive -NoProfile -EncodedCommand ${encoded}</rsp:Arguments></rsp:CommandLine>`,
      timeoutSec
    ), timeoutSec * 1000 + 5000);

    const cmdId = parseTag(cmdResp, 'CommandId');
    if (!cmdId) throw new Error('Failed to get CommandId');

    // 3. Poll for output
    let stdout = '', stderr = '', exitCode = null;
    const deadline = Date.now() + timeoutSec * 1000;

    while (exitCode === null && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 500));
      const recvResp = await winrmPost(server, soap(
        'http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Receive', sel,
        `<rsp:Receive><rsp:DesiredStream CommandId="${cmdId}">stdout stderr</rsp:DesiredStream></rsp:Receive>`,
        timeoutSec
      ), timeoutSec * 1000 + 5000);

      const s = parseStreams(recvResp);
      stdout += s.stdout;
      stderr += s.stderr;
      if (s.done) exitCode = s.exitCode ?? 0;
    }

    return { exitCode: exitCode ?? -1, stdout, stderr, durationMs: Date.now() - start };

  } catch (e) {
    return { exitCode: -1, stdout: '', stderr: e.message, durationMs: Date.now() - start };
  } finally {
    // 4. Delete shell
    if (shellId) {
      try {
        await winrmPost(server, soap(
          'http://schemas.xmlsoap.org/ws/2004/09/transfer/Delete',
          `<wsman:SelectorSet><wsman:Selector Name="ShellId">${shellId}</wsman:Selector></wsman:SelectorSet>`,
          '', 10
        ), 10000);
      } catch {}
    }
  }
}

// ── Get system metrics ────────────────────────────────────────────────────────
async function getMetrics(server) {
  const ps = [
    "$ErrorActionPreference='SilentlyContinue'",
    "$cpu=[math]::Round((Get-CimInstance Win32_Processor|Measure-Object -Property LoadPercentage -Average).Average)",
    "$os=Get-CimInstance Win32_OperatingSystem",
    "$ram=[math]::Round((($os.TotalVisibleMemorySize-$os.FreePhysicalMemory)/$os.TotalVisibleMemorySize)*100)",
    "$diskParts=@()",
    "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {",
    "  if ($_.Size -gt 0) { $p=[math]::Round((($_.Size-$_.FreeSpace)/$_.Size)*100) } else { $p=0 }",
    "  $diskParts += \"$($_.DeviceID)=$p\"",
    "}",
    "$disksStr=($diskParts -join ';'); if (-not $disksStr) { $disksStr='NONE' }",
    "$diskMax=0",
    "foreach ($dp in $diskParts) { $v=[int]($dp.Split('=')[1]); if ($v -gt $diskMax) { $diskMax=$v } }",
    "$up=[int]((Get-Date)-$os.LastBootUpTime).TotalSeconds",
    "$procs=(Get-Process).Count",
    "$netStats=Get-NetAdapterStatistics -ErrorAction SilentlyContinue | Where-Object {$_.ReceivedBytes -gt 0 -or $_.SentBytes -gt 0}",
    "$rx=($netStats | Measure-Object -Property ReceivedBytes -Sum).Sum",
    "$tx=($netStats | Measure-Object -Property SentBytes -Sum).Sum",
    "if (-not $rx) {$rx=0}; if (-not $tx) {$tx=0}",
    "Write-Output \"SM_CPU:$cpu|SM_RAM:$ram|SM_DISK:$diskMax|SM_DISKS:$disksStr|SM_UP:$up|SM_PROCS:$procs|SM_RX:$rx|SM_TX:$tx|SM_OS:$($os.Caption)\"",
  ].join("\n");

  const r = await executeScript(server, ps, 30);
  if (!r.stdout.includes('SM_CPU')) throw new Error(r.stderr || 'WinRM metrics failed');

  const g = key => {
    const m = r.stdout.match(new RegExp(`SM_${key}:([^|\\r\\n]+)`));
    return m ? m[1].trim() : null;
  };

  // Parse per-drive disk info
  const disks = [];
  const disksRaw = g('DISKS');
  if (disksRaw && disksRaw !== 'NONE') {
    for (const part of disksRaw.split(';')) {
      const [name, pct] = part.split('=');
      if (name && pct) disks.push({ name, percent: Math.min(100, Math.max(0, parseInt(pct))) });
    }
  }

  const cDisk = disks.find(d => d.name.toUpperCase().startsWith('C'));

  return {
    cpu_pct:      Math.min(100, parseInt(g('CPU') || 0)),
    mem_pct:      Math.min(100, parseInt(g('RAM') || 0)),
    disk_pct:     cDisk ? cDisk.percent : Math.min(100, parseInt(g('DISK') || 0)),
    disks,
    uptime_s:     parseInt(g('UP') || 0),
    process_count:parseInt(g('PROCS') || 0),
    net_rx_bytes: parseInt(g('RX') || 0),
    net_tx_bytes: parseInt(g('TX') || 0),
    os_name:      g('OS') || 'Windows',
  };
}

// ── Get process list ──────────────────────────────────────────────────────────
async function getProcesses(server, limit = 50) {
  const ps = `Get-Process | Sort-Object CPU -Descending | Select-Object -First ${limit} | ForEach-Object { "$($_.Id)|$($_.ProcessName)|$([math]::Round($_.CPU,1))|$([math]::Round($_.WorkingSet/1MB,1))" }`;
  const r  = await executeScript(server, ps, 30);
  const procs = [];
  for (const line of r.stdout.trim().split('\n')) {
    const parts = line.trim().split('|');
    if (parts.length < 4) continue;
    try {
      procs.push({ pid: parseInt(parts[0]), name: parts[1], cpu: parseFloat(parts[2]), mem_mb: parseFloat(parts[3]) });
    } catch {}
  }
  return procs;
}

// ── Test connection ───────────────────────────────────────────────────────────
async function testConnection(server) {
  const start = Date.now();
  try {
    const r  = await executeScript(server, 'Write-Output "sm_ok_$(hostname)"', 15);
    const ok = r.stdout.includes('sm_ok_');
    const hn = r.stdout.match(/sm_ok_(.+)/);
    return { ok, hostname: hn ? hn[1].trim() : null, durationMs: Date.now() - start };
  } catch (e) {
    return { ok: false, error: e.message, durationMs: Date.now() - start };
  }
}

module.exports = { executeScript, getMetrics, getProcesses, testConnection };
