#!/usr/bin/env python3
import http.server
import socketserver
import json
import subprocess
import platform
import tempfile
import os

PORT = 8182

def get_system_printers():
    printers = []
    system = platform.system().lower()
    try:
        if system == "windows":
            out = subprocess.check_output(
                ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "Get-Printer | Select-Object -ExpandProperty Name"],
                text=True, errors="ignore"
            )
            printers = [line.strip() for line in out.splitlines() if line.strip()]
            if not printers:
                wmic_out = subprocess.check_output(["wmic.exe", "printer", "get", "name"], text=True, errors="ignore")
                printers = [line.strip() for line in wmic_out.splitlines() if line.strip() and line.strip().lower() != "name"]
        else:
            try:
                out = subprocess.check_output(["lpstat", "-e"], text=True, errors="ignore")
                printers = [line.strip() for line in out.splitlines() if line.strip()]
            except Exception:
                out = subprocess.check_output(["lpstat", "-a"], text=True, errors="ignore")
                printers = [line.split()[0].strip() for line in out.splitlines() if line.strip()]
    except Exception as e:
        print("Error fetching OS printers:", e)

    return list(dict.fromkeys(printers))

def print_raw_win32_ctypes(printer_name, data_bytes):
    import ctypes
    from ctypes import wintypes

    class DOCINFOA(ctypes.Structure):
        _fields_ = [
            ("pDocName", ctypes.c_char_p),
            ("pOutputFile", ctypes.c_char_p),
            ("pDatatype", ctypes.c_char_p),
        ]

    winspool = ctypes.WinDLL("winspool.drv")

    OpenPrinter = winspool.OpenPrinterA
    OpenPrinter.argtypes = [ctypes.c_char_p, ctypes.POINTER(wintypes.HANDLE), ctypes.c_void_p]
    OpenPrinter.restype = wintypes.BOOL

    ClosePrinter = winspool.ClosePrinter
    ClosePrinter.argtypes = [wintypes.HANDLE]
    ClosePrinter.restype = wintypes.BOOL

    StartDocPrinter = winspool.StartDocPrinterA
    StartDocPrinter.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(DOCINFOA)]
    StartDocPrinter.restype = wintypes.DWORD

    EndDocPrinter = winspool.EndDocPrinter
    EndDocPrinter.argtypes = [wintypes.HANDLE]
    EndDocPrinter.restype = wintypes.BOOL

    StartPagePrinter = winspool.StartPagePrinter
    StartPagePrinter.argtypes = [wintypes.HANDLE]
    StartPagePrinter.restype = wintypes.BOOL

    EndPagePrinter = winspool.EndPagePrinter
    EndPagePrinter.argtypes = [wintypes.HANDLE]
    EndPagePrinter.restype = wintypes.BOOL

    WritePrinter = winspool.WritePrinter
    WritePrinter.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
    WritePrinter.restype = wintypes.BOOL

    h_printer = wintypes.HANDLE()
    if not OpenPrinter(printer_name.encode('utf-8'), ctypes.byref(h_printer), None):
        raise RuntimeError(f"Could not open printer '{printer_name}'")

    doc_info = DOCINFOA(
        pDocName=b"RAW Label Document",
        pOutputFile=None,
        pDatatype=b"RAW"
    )

    try:
        doc_id = StartDocPrinter(h_printer, 1, ctypes.byref(doc_info))
        if doc_id == 0:
            raise RuntimeError("StartDocPrinter failed")

        if not StartPagePrinter(h_printer):
            raise RuntimeError("StartPagePrinter failed")

        dw_written = wintypes.DWORD(0)
        success = WritePrinter(h_printer, data_bytes, len(data_bytes), ctypes.byref(dw_written))

        EndPagePrinter(h_printer)
        EndDocPrinter(h_printer)

        if not success:
            raise RuntimeError("WritePrinter failed")
    finally:
        ClosePrinter(h_printer)

def print_raw_to_printer(printer_name, raw_data):
    system = platform.system().lower()
    valid_printers = get_system_printers()

    if printer_name not in valid_printers:
        raise ValueError(f"Impressora '{printer_name}' não foi encontrada no sistema operacional.")

    data_bytes = raw_data.encode('utf-8')

    if system == "windows":
        try:
            print_raw_win32_ctypes(printer_name, data_bytes)
        except Exception:
            # Fallback to PowerShell Win32 P/Invoke
            with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.raw', encoding='utf-8') as f:
                f.write(raw_data)
                temp_path = f.name

            try:
                escaped_printer = printer_name.replace("'", "''")
                escaped_file = temp_path.replace("'", "''")
                ps_script = f"$printer = '{escaped_printer}'; $file = '{escaped_file}'; $code = 'using System; using System.IO; using System.Runtime.InteropServices; public class P {{ [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)] public class D {{ [MarshalAs(UnmanagedType.LPStr)] public string pDocName; [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPStr)] public string pDatatype; }} [DllImport(\"winspool.drv\", EntryPoint=\"OpenPrinterA\")] public static extern bool O(string s, out IntPtr h, IntPtr p); [DllImport(\"winspool.drv\")] public static extern bool ClosePrinter(IntPtr h); [DllImport(\"winspool.drv\", EntryPoint=\"StartDocPrinterA\")] public static extern bool SD(IntPtr h, int l, [In, MarshalAs(UnmanagedType.LPStruct)] D d); [DllImport(\"winspool.drv\")] public static extern bool ED(IntPtr h); [DllImport(\"winspool.drv\")] public static extern bool SP(IntPtr h); [DllImport(\"winspool.drv\")] public static extern bool EP(IntPtr h); [DllImport(\"winspool.drv\")] public static extern bool W(IntPtr h, IntPtr p, int c, out int w); public static void Print(string p, string f) {{ byte[] b = File.ReadAllBytes(f); IntPtr h; D d = new D {{ pDocName=\"RAW\", pDatatype=\"RAW\" }}; if (O(p, out h, IntPtr.Zero)) {{ if (SD(h, 1, d)) {{ if (SP(h)) {{ IntPtr u = Marshal.AllocCoTaskMem(b.Length); Marshal.Copy(b, 0, u, b.Length); int w; W(h, u, b.Length, out w); Marshal.FreeCoTaskMem(u); EP(h); }} ED(h); }} ClosePrinter(h); }} }} }}'; Add-Type -TypeDefinition $code; [P]::Print($printer, $file);"
                subprocess.run(
                    ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps_script],
                    check=True
                )
            finally:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
    else:
        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.raw', encoding='utf-8') as f:
            f.write(raw_data)
            temp_path = f.name
        try:
            subprocess.run(["lpr", "-P", printer_name, "-o", "raw", temp_path], check=True)
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

class PrinterRequestHandler(http.server.BaseHTTPRequestHandler):
    def _set_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(200)
        self._set_cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path in ["/printers", "/"]:
            printers = get_system_printers()
            response = json.dumps({"status": "success", "printers": printers}).encode("utf-8")
            self.send_response(200)
            self._set_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/print":
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                payload = json.loads(body)
                printer = payload.get("printer")
                data = payload.get("data")
                if not printer or not data:
                    res = json.dumps({"status": "error", "message": "Parâmetros 'printer' e 'data' são obrigatórios"}).encode("utf-8")
                    self.send_response(400)
                else:
                    print_raw_to_printer(printer, data)
                    res = json.dumps({"status": "success", "message": "Impresso com sucesso"}).encode("utf-8")
                    self.send_response(200)
            except Exception as e:
                res = json.dumps({"status": "error", "message": str(e)}).encode("utf-8")
                self.send_response(500)

            self._set_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(res)))
            self.end_headers()
            self.wfile.write(res)

if __name__ == "__main__":
    with socketserver.TCPServer(("127.0.0.1", PORT), PrinterRequestHandler) as httpd:
        print(f"🖨️ Agente Python de Impressão Seguro rodando em http://127.0.0.1:{PORT}")
        httpd.serve_forever()
