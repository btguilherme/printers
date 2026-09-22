/**
 * Universal Local Print Spooler Agent
 * Lightweight HTTP server for listing installed OS printers & printing RAW label commands.
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

// Get list of installed printers from Operating System safely
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

// Print RAW command safely to OS printer queue using Win32 API winspool.drv on Windows
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
      // Native Win32 Raw Spooling via PowerShell .NET C# P/Invoke wrapper
      const psScript = `
        $printerName = '${printerName.replace(/'/g, "''")}';
        $file = '${tempFilePath.replace(/'/g, "''")}';
        $type = @"
        using System;
        using System.IO;
        using System.Runtime.InteropServices;
        public class Win32RawPrinter {
            [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
            public class DOCINFOA {
                [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
                [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
                [MarshalAs(UnmanagedType.LPStr)] public string pDatatype;
            }
            [DllImport("winspool.drv", EntryPoint = "OpenPrinterA", ExactSpelling = true, SetLastError = true)]
            public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
            [DllImport("winspool.drv", ExactSpelling = true, SetLastError = true)]
            public static extern bool ClosePrinter(IntPtr hPrinter);
            [DllImport("winspool.drv", EntryPoint = "StartDocPrinterA", ExactSpelling = true, SetLastError = true)]
            public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
            [DllImport("winspool.drv", ExactSpelling = true, SetLastError = true)]
            public static extern bool EndDocPrinter(IntPtr hPrinter);
            [DllImport("winspool.drv", ExactSpelling = true, SetLastError = true)]
            public static extern bool StartPagePrinter(IntPtr hPrinter);
            [DllImport("winspool.drv", ExactSpelling = true, SetLastError = true)]
            public static extern bool EndPagePrinter(IntPtr hPrinter);
            [DllImport("winspool.drv", ExactSpelling = true, SetLastError = true)]
            public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

            public static bool SendFileToPrinter(string szPrinterName, string fileName) {
                byte[] bytes = File.ReadAllBytes(fileName);
                IntPtr hPrinter = IntPtr.Zero;
                DOCINFOA di = new DOCINFOA();
                di.pDocName = "RAW Label Job";
                di.pDatatype = "RAW";
                if (OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) {
                    if (StartDocPrinter(hPrinter, 1, di)) {
                        if (StartPagePrinter(hPrinter)) {
                            IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
                            Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
                            int dwWritten;
                            bool bSuccess = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out dwWritten);
                            Marshal.FreeCoTaskMem(pUnmanagedBytes);
                            EndPagePrinter(hPrinter);
                            EndDocPrinter(hPrinter);
                            ClosePrinter(hPrinter);
                            return bSuccess;
                        }
                    }
                }
                return false;
            }
        }
"@;
        Add-Type -TypeDefinition $type -Language CSharp;
        [Win32RawPrinter]::SendFileToPrinter($printerName, $file);
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
