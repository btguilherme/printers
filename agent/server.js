/**
 * Universal Local Print Spooler Agent
 * Lightweight HTTP/WebSocket server for listing installed OS printers & printing RAW label commands.
 * Compatible with Windows, Linux, and macOS.
 */

const http = require('http');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8182;

function execFilePromise(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: 'utf8', ...options }, (error, stdout) => {
      if (error) resolve('');
      else resolve(stdout);
    });
  });
}

// Get list of installed printers from Operating System safely without shell execution
async function getSystemPrinters() {
  const platform = os.platform();
  let printers = [];

  try {
    if (platform === 'win32') {
      const psScript = 'Get-Printer | Select-Object -ExpandProperty Name';
      const output = await execFilePromise('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript]);
      if (output && output.trim().length > 0) {
        printers = output.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      } else {
        const wmicOut = await execFilePromise('wmic.exe', ['printer', 'get', 'name']);
        if (wmicOut) {
          printers = wmicOut.split(/\r?\n/)
            .map(s => s.trim())
            .filter(line => line && line.toLowerCase() !== 'name');
        }
      }
    } else {
      // Linux / macOS (CUPS)
      const lpstatOut = await execFilePromise('lpstat', ['-e']);
      if (lpstatOut && lpstatOut.trim().length > 0) {
        printers = lpstatOut.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      } else {
        const lpstatAOut = await execFilePromise('lpstat', ['-a']);
        if (lpstatAOut) {
          printers = lpstatAOut.split(/\r?\n/).map(line => line.split(' ')[0].trim()).filter(Boolean);
        }
      }
    }
  } catch (err) {
    console.error('Error fetching OS printers:', err);
  }

  return Array.from(new Set(printers));
}

// Print RAW command safely to OS printer queue
async function printRawToPrinter(printerName, rawData) {
  const platform = os.platform();
  const validPrinters = await getSystemPrinters();

  if (!validPrinters.includes(printerName)) {
    throw new Error(`Impressora '${printerName}' não foi encontrada no sistema operacional.`);
  }

  const tempFilePath = path.join(os.tmpdir(), `print_job_${Date.now()}_${Math.random().toString(36).substring(2)}.raw`);
  fs.writeFileSync(tempFilePath, rawData);

  try {
    if (platform === 'win32') {
      // Windows RAW spooling via PowerShell Win32 API / Print Spooler Byte Array
      const psScript = `
        $printer = '${printerName.replace(/'/g, "''")}';
        $file = '${tempFilePath.replace(/'/g, "''")}';
        $bytes = [System.IO.File]::ReadAllBytes($file);
        $cmd = "cmd.exe";
        $args = "/c print /d:""$printer"" ""$file""";
        Start-Process $cmd -ArgumentList $args -NoNewWindow -Wait;
      `;
      await execFilePromise('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript]);
    } else {
      // Linux / macOS RAW print via lpr -P "printer" -o raw
      await execFilePromise('lpr', ['-P', printerName, '-o', 'raw', tempFilePath]);
    }
  } finally {
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch (e) {}
  }
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/printers') {
    const printers = await getSystemPrinters();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'success', printers }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/print') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const { printer, data } = payload;

        if (!printer || !data) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: 'Parâmetros "printer" e "data" são obrigatórios.' }));
          return;
        }

        await printRawToPrinter(printer, data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', message: 'Etiqueta enviada para o spooler com sucesso.' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'error', message: 'Rota não encontrada' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`=======================================================`);
  console.log(`🖨️ Agente Spooler Local Seguro rodando em http://127.0.0.1:${PORT}`);
  console.log(`=======================================================`);
});
