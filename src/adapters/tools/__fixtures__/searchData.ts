/** Fixtures de respuestas de proveedores de búsqueda (sin red). */

export const BRAVE_PAYLOAD: unknown = {
  web: {
    results: [
      { title: 'Alpha Result', url: 'https://example.com/alpha', description: 'Alpha snippet' },
      { title: 'Beta Result', url: 'https://example.org/beta?x=1', description: 'Beta snippet' },
    ],
  },
};

export const BRAVE_DUPLICATE_PAYLOAD: unknown = {
  web: {
    results: [
      { title: 'One', url: 'https://example.com/one', description: 'First' },
      { title: 'One again', url: 'https://example.com/one#section', description: 'Duplicate' },
      { title: 'Two', url: 'https://example.com/two' },
    ],
  },
};

export const TAVILY_PAYLOAD: unknown = {
  results: [
    { title: 'Tavily Hit', url: 'https://tavily.example/page', content: 'Tavily content' },
  ],
};

export const PROXY_SEARCH_PAYLOAD: unknown = {
  provider: 'brave',
  results: [
    { url: 'https://proxy.example/a', title: 'Proxy A', snippet: 'From proxy' },
    { url: 'https://proxy.example/b', title: 'Proxy B' },
  ],
};

/** Texto de un `web_search_exa` (bloques `Title/URL/Published/Author/Highlights` separados por `---`). */
export const EXA_RESULT_TEXT =
  'Title: First Exa Hit\n' +
  'URL: https://exa.example/one\n' +
  'Published: 2026-01-01T00:00:00.000Z\n' +
  'Author: N/A\n' +
  'Highlights:\n' +
  'First highlight line\n' +
  'with more detail\n' +
  '\n---\n\n' +
  'Title: Second Exa Hit\n' +
  'URL: https://exa.example/two\n' +
  'Published: N/A\n' +
  'Author: N/A\n' +
  'Highlights:\n' +
  'Second highlight line';

/** Respuesta SSE de `mcp.exa.ai` con el texto de arriba. */
export const EXA_SSE = `event: message\ndata: ${JSON.stringify({
  result: { content: [{ type: 'text', text: EXA_RESULT_TEXT }] },
})}\n\n`;

export const DDG_HTML = `<!DOCTYPE html>
<html><body>
  <div class="result results_links web-result">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Falpha%3Fx%3D1&amp;rut=abc">Alpha &amp; <b>Beta</b></a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Falpha">First <b>snippet</b> text &amp; more</a>
  </div>
  <div class="result results_links web-result">
    <h2 class="result__title"><a class="result__a" href="https://example.org/beta">Second Result</a></h2>
    <a class="result__snippet">Second snippet</a>
  </div>
</body></html>`;

export const ARTICLE_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Doc Title</title>
  <meta name="description" content="Short description">
  <meta property="og:title" content="OG Title">
</head>
<body>
  <nav>Navigation noise</nav>
  <article>
    <h1>Heading</h1>
    <p>First   paragraph &amp; more.</p>
    <script>alert(1)</script>
    <style>.x { color: red; }</style>
    <p>Second &#233;l&#xe9;ment.</p>
  </article>
  <div>Outside text</div>
</body>
</html>`;
