import http.server
import socketserver
import socket
import os
import webbrowser

PORT = 8080

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'

def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    local_ip = get_local_ip()

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('0.0.0.0', PORT), http.server.SimpleHTTPRequestHandler) as httpd:
        print('============================================================')
        print(' 🎓 スマート授業プリント＆AI暗記ノート サーバー起動完了')
        print('============================================================')
        print(f' 💻 PCで開く場合      : http://localhost:{PORT}')
        print(f' 📱 スマホで開く場合  : http://{local_ip}:{PORT}')
        print('    (※PCと同じWi-Fiにスマホを繋いで上記URLを開いてください)')
        print('============================================================')
        try:
            webbrowser.open(f'http://localhost:{PORT}')
        except Exception:
            pass
        httpd.serve_forever()

if __name__ == '__main__':
    main()
