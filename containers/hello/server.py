import http.server
import socketserver

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"hello from field-hello-container\n"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass

socketserver.TCPServer(("", 8080), Handler).serve_forever()
