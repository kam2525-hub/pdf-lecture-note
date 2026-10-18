import http.server
import socketserver
import threading
import subprocess
import os
import sys
import json

def run_browser_test(port, path_and_query, done_event, result_holder):
    done_event.clear()
    result_holder.clear()
    chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
    url = f'http://127.0.0.1:{port}{path_and_query}'
    cmd = [
        chrome_path,
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        url,
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    finished = done_event.wait(timeout=25.0)
    proc.terminate()
    if not finished:
        return {'status': 'TIMEOUT', 'url': url}
    return dict(result_holder)

def main():
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root_dir)

    done_event = threading.Event()
    received_payload = {}

    class TestHandler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, format, *args):
            pass

        def do_POST(self):
            if self.path == '/__test_result__':
                length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(length).decode('utf-8')
                received_payload.update(json.loads(body))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'OK')
                done_event.set()
            elif self.path == '/__test_log__':
                length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(length).decode('utf-8')
                print('[BrowserLog]', body)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'OK')
            else:
                self.send_response(404)
                self.end_headers()

    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(('127.0.0.1', 0), TestHandler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    print('=== 1. Running Unit & PDF Engine Tests ===')
    unit_res = run_browser_test(port, '/tests/test_suite.html', done_event, received_payload)
    print(f"Status: {unit_res.get('status')}, Total Assertions: {unit_res.get('total')}")
    if unit_res.get('status') != 'ALL_PASSED':
        print(json.dumps(unit_res, ensure_ascii=False, indent=2))
        httpd.shutdown()
        sys.exit(1)

    print('=== 2. Running Full UI E2E Tests ===')
    ui_res = run_browser_test(port, '/index.html?e2e=1', done_event, received_payload)
    print(f"Status: {ui_res.get('status')}, Total Assertions: {ui_res.get('total')}")
    if ui_res.get('status') != 'ALL_PASSED':
        print(json.dumps(ui_res, ensure_ascii=False, indent=2))
        httpd.shutdown()
        sys.exit(1)

    httpd.shutdown()
    print('ALL UNIT AND UI E2E TESTS PASSED!')

if __name__ == '__main__':
    main()
