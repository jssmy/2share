import * as path from 'path';
import { CodeSnippetSnapshot, GitCommitContext, SnapshotTheme } from '../types';

interface ThemeColors {
  background: string;
  cardBackground: string;
  titleBar: string;
  text: string;
  lineNumbers: string;
  keyword: string;
  string: string;
  function: string;
  comment: string;
  number: string;
}

const THEMES: Record<SnapshotTheme, ThemeColors> = {
  nord: {
    background: '#242933',
    cardBackground: '#2e3440',
    titleBar: '#3b4252',
    text: '#d8dee9',
    lineNumbers: '#4c566a',
    keyword: '#81a1c1',
    string: '#a3be8c',
    function: '#88c0d0',
    comment: '#616e88',
    number: '#b48ead',
  },
  'one-dark-pro': {
    background: '#21252b',
    cardBackground: '#282c34',
    titleBar: '#21252b',
    text: '#abb2bf',
    lineNumbers: '#4b5263',
    keyword: '#c678dd',
    string: '#98c379',
    function: '#61afef',
    comment: '#5c6370',
    number: '#d19a66',
  },
  'github-dark': {
    background: '#0d1117',
    cardBackground: '#161b22',
    titleBar: '#21262d',
    text: '#c9d1d9',
    lineNumbers: '#484f58',
    keyword: '#ff7b72',
    string: '#a5d6ff',
    function: '#d2a8ff',
    comment: '#8b949e',
    number: '#79c0ff',
  },
  dracula: {
    background: '#1e1f29',
    cardBackground: '#282a36',
    titleBar: '#21222c',
    text: '#f8f8f2',
    lineNumbers: '#6272a4',
    keyword: '#ff79c6',
    string: '#f1fa8c',
    function: '#50fa7b',
    comment: '#6272a4',
    number: '#bd93f9',
  },
};

export class SnapshotService {
  /**
   * Extrae el fragmento de código más representativo del commit
   * Cumple con REQ-003 Escenario 2
   */
  public extractBestSnippet(commitContext: GitCommitContext): {
    code: string;
    fileName: string;
    language: string;
  } {
    // Filtrar archivos poco interesantes (locks, configs autogeneradas, markdown)
    const validFiles = commitContext.changedFiles.filter((f) => {
      const lower = f.filePath.toLowerCase();
      return (
        !lower.endsWith('.lock') &&
        !lower.endsWith('lock.json') &&
        !lower.endsWith('.map') &&
        f.patch &&
        f.patch.trim().length > 0
      );
    });

    const targetFile = validFiles[0] || commitContext.changedFiles[0];

    if (!targetFile || !targetFile.patch) {
      return {
        code: `// Commit: ${commitContext.shortHash}\n// ${commitContext.message}\n// Sin cambios visuales directos en archivos de texto`,
        fileName: 'commit-summary.txt',
        language: 'plaintext',
      };
    }

    const lines = targetFile.patch.split('\n');
    const snippetLines: string[] = [];

    // Recoger líneas añadidas o de contexto, omitiendo encabezados de git diff
    for (const line of lines) {
      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git')) {
        continue;
      }
      if (line.startsWith('@@')) {
        continue;
      }
      if (line.startsWith('+')) {
        // Línea añadida
        snippetLines.push(line.substring(1));
      } else if (line.startsWith(' ')) {
        // Línea de contexto
        snippetLines.push(line.substring(1));
      }

      if (snippetLines.length >= 22) {
        break; // Mantener tamaño estético para LinkedIn
      }
    }

    const code =
      snippetLines.length > 0
        ? snippetLines.join('\n')
        : `// Archivo: ${targetFile.filePath}\n// +${targetFile.additions} -${targetFile.deletions}`;

    const ext = path.extname(targetFile.filePath).replace('.', '') || 'typescript';

    return {
      code,
      fileName: path.basename(targetFile.filePath),
      language: this.mapExtensionToLanguage(ext),
    };
  }

  private mapExtensionToLanguage(ext: string): string {
    const map: Record<string, string> = {
      ts: 'typescript',
      js: 'javascript',
      tsx: 'typescript',
      jsx: 'javascript',
      py: 'python',
      rs: 'rust',
      go: 'go',
      java: 'java',
      rb: 'ruby',
      php: 'php',
      html: 'html',
      css: 'css',
      json: 'json',
      md: 'markdown',
    };
    return map[ext] || ext;
  }

  /**
   * Resalta sintaxis básica en SVG
   */
  private highlightCode(code: string, colors: ThemeColors): string[] {
    const escapeXml = (unsafe: string) =>
      unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

    const lines = code.split('\n');

    return lines.map((line) => {
      let escaped = escapeXml(line);

      // Comentarios
      if (escaped.trim().startsWith('//') || escaped.trim().startsWith('#')) {
        return `<tspan fill="${colors.comment}">${escaped}</tspan>`;
      }

      // Palabras clave comunes
      escaped = escaped.replace(
        /\b(import|export|from|const|let|var|function|async|await|return|if|else|switch|case|break|class|interface|type|extends|implements|new|try|catch|finally|throw|for|while|def|fn)\b/g,
        `<tspan fill="${colors.keyword}">$1</tspan>`
      );

      // Cadenas de texto
      escaped = escaped.replace(
        /(&quot;.*?&quot;|&apos;.*?&apos;|`.*?`)/g,
        `<tspan fill="${colors.string}">$1</tspan>`
      );

      // Números
      escaped = escaped.replace(
        /\b(\d+)\b/g,
        `<tspan fill="${colors.number}">$1</tspan>`
      );

      return escaped;
    });
  }

  /**
   * Genera el SVG completo estilizado
   * Cumple con REQ-003 Escenarios 1 y 3
   */
  public generateSnapshot(
    fileName: string,
    language: string,
    code: string,
    themeName: SnapshotTheme = 'nord'
  ): CodeSnippetSnapshot {
    const theme = THEMES[themeName] || THEMES.nord;
    const lines = this.highlightCode(code, theme);

    const lineHeight = 24;
    const startY = 85;
    const paddingX = 40;
    const innerCardPadding = 24;
    const headerHeight = 44;

    const codeHeight = lines.length * lineHeight;
    const cardHeight = headerHeight + codeHeight + innerCardPadding * 2;
    const totalHeight = cardHeight + 80;
    const totalWidth = 840;
    const cardWidth = totalWidth - paddingX * 2;

    const renderedLines = lines
      .map((lineHtml, index) => {
        const y = startY + index * lineHeight;
        const lineNum = String(index + 1).padStart(2, ' ');
        return `
        <tspan x="${paddingX + 20}" y="${y}" fill="${theme.lineNumbers}" font-family="monospace">${lineNum}</tspan>
        <tspan x="${paddingX + 60}" y="${y}" fill="${theme.text}">${lineHtml}</tspan>
      `;
      })
      .join('');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}">
  <defs>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#000000" flood-opacity="0.45" />
    </filter>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e293b" />
      <stop offset="100%" stop-color="#0f172a" />
    </linearGradient>
  </defs>

  <!-- Fondo de la imagen -->
  <rect width="${totalWidth}" height="${totalHeight}" fill="url(#bgGrad)" rx="16" />

  <!-- Tarjeta de Código (Ventana) -->
  <g filter="url(#shadow)">
    <!-- Cuerpo de la ventana -->
    <rect x="${paddingX}" y="28" width="${cardWidth}" height="${cardHeight}" rx="12" fill="${theme.cardBackground}" stroke="#334155" stroke-width="1" />
    
    <!-- Barra superior de la ventana -->
    <path d="M ${paddingX} 28 h ${cardWidth} a 12 12 0 0 1 12 12 v 32 h -${cardWidth + 24} v -32 a 12 12 0 0 1 12 -12 z" fill="${theme.titleBar}" />

    <!-- Botones macOS de la ventana -->
    <circle cx="${paddingX + 20}" cy="50" r="6" fill="#ff5f56" />
    <circle cx="${paddingX + 40}" cy="50" r="6" fill="#ffbd2e" />
    <circle cx="${paddingX + 60}" cy="50" r="6" fill="#27c93f" />

    <!-- Título de archivo centrado -->
    <text x="${totalWidth / 2}" y="54" fill="${theme.text}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="13" font-weight="500" text-anchor="middle" opacity="0.8">
      ${fileName}
    </text>

    <!-- Líneas de código -->
    <text font-family="'JetBrains Mono', 'Fira Code', Menlo, Monaco, Consolas, monospace" font-size="14" xml:space="preserve">
      ${renderedLines}
    </text>
  </g>
</svg>`;

    const base64Svg = Buffer.from(svg).toString('base64');
    const dataUri = `data:image/svg+xml;base64,${base64Svg}`;

    return {
      fileName,
      language,
      code,
      theme: themeName,
      svgContent: svg,
      imageBuffer: Buffer.from(svg),
      dataUri,
      mimeType: 'image/svg+xml',
    };
  }
}
