import * as http from 'http';
import * as url from 'url';
import * as crypto from 'crypto';

export interface OAuthResult {
  code: string;
  state: string;
}

export class OAuthServer {
  private server?: http.Server;
  private readonly port: number;

  constructor(port = 54321) {
    this.port = port;
  }

  public getRedirectUri(): string {
    return `http://127.0.0.1:${this.port}/callback`;
  }

  /**
   * Genera un identificador de estado aleatorio para prevenir CSRF
   */
  public generateState(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Inicia un servidor HTTP local para capturar la redirección de LinkedIn
   */
  public waitForAuthorizationCode(expectedState: string, timeoutMs = 300000): Promise<OAuthResult> {
    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout;

      this.server = http.createServer((req, res) => {
        const parsedUrl = url.parse(req.url || '', true);

        if (parsedUrl.pathname === '/callback') {
          const { code, state, error, error_description } = parsedUrl.query;

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.getErrorHtml(String(error_description || error)));
            this.stop();
            clearTimeout(timeoutId);
            reject(new Error(`LinkedIn OAuth Error: ${error_description || error}`));
            return;
          }

          if (!code || typeof code !== 'string') {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.getErrorHtml('No se recibió el código de autorización.'));
            this.stop();
            clearTimeout(timeoutId);
            reject(new Error('No se recibió el código de autorización en el callback.'));
            return;
          }

          if (state !== expectedState) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.getErrorHtml('El estado de seguridad (CSRF) no coincide.'));
            this.stop();
            clearTimeout(timeoutId);
            reject(new Error('Discrepancia en el parámetro de estado de seguridad (state).'));
            return;
          }

          // Respuesta exitosa al navegador
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(this.getSuccessHtml());

          this.stop();
          clearTimeout(timeoutId);
          resolve({ code, state });
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      });

      this.server.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(err);
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        // Servidor escuchando en localhost
      });

      timeoutId = setTimeout(() => {
        this.stop();
        reject(new Error('Tiempo de espera agotado para la autorización en el navegador (5 min).'));
      }, timeoutMs);
    });
  }

  public stop(): void {
    if (this.server) {
      this.server.close();
      this.server = undefined;
    }
  }

  private getSuccessHtml(): string {
    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>2share - ¡Autorización Exitosa!</title>
  <style>
    body {
      background: #0d1117;
      color: #e6edf3;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      padding: 36px 40px;
      text-align: center;
      max-width: 440px;
      box-shadow: 0 16px 36px rgba(0,0,0,0.5);
    }
    .icon {
      font-size: 54px;
      margin-bottom: 12px;
    }
    h1 {
      margin: 0 0 10px 0;
      color: #58a6ff;
      font-size: 22px;
    }
    p {
      color: #8b949e;
      font-size: 14px;
      line-height: 1.5;
      margin: 0 0 20px 0;
    }
    .badge {
      display: inline-block;
      background: rgba(46, 160, 67, 0.15);
      color: #3fb950;
      border: 1px solid rgba(46, 160, 67, 0.3);
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🚀</div>
    <h1>¡Conectado con LinkedIn!</h1>
    <p>La autorización se completó con éxito. Tus credenciales han sido transferidas de forma segura a VS Code.</p>
    <div class="badge">✅ Ya puedes volver a tu editor</div>
  </div>
  <script>
    setTimeout(() => {
      window.close();
    }, 4000);
  </script>
</body>
</html>`;
  }

  private getErrorHtml(errorMessage: string): string {
    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>2share - Error de Autorización</title>
  <style>
    body {
      background: #0d1117;
      color: #e6edf3;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
    }
    .card {
      background: #161b22;
      border: 1px solid #f85149;
      border-radius: 12px;
      padding: 36px 40px;
      text-align: center;
      max-width: 440px;
    }
    h1 { color: #f85149; font-size: 20px; }
    p { color: #8b949e; font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size: 48px;">⚠️</div>
    <h1>Fallo en la Autorización</h1>
    <p>${errorMessage}</p>
    <p>Por favor regresa a VS Code y vuelve a intentarlo.</p>
  </div>
</body>
</html>`;
  }
}
