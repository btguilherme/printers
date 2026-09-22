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

def print_raw_to_printer(printer_name, raw_data):
    system = platform.system().lower()
    valid_printers = get_system_printers()

    if printer_name not in valid_printers:
        raise ValueError(f"Impressora '{printer_name}' não foi encontrada no sistema operacional.")

    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.raw', encoding='utf-8') as f:
        f.write(raw_data)
        temp_path = f.name

    try:
        if system == "windows":
            escaped_printer = printer_name.replace("'", "''")
            escaped_file = temp_path.replace("'", "''")
            ps_script = f"$printer = '{escaped_printer}'; $file = '{escaped_file}'; $cmd = 'cmd.exe'; $args = '/c print /d:\"' + $printer + '\" \"' + $file + '\"'; Start-Process $cmd -ArgumentList $args -NoNewWindow -Wait;"
            subprocess.run(
                ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps_script],
                check=True
            )
        else:
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
