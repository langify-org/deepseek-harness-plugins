/**
 * The page the integration tests share: a field to type into, a button to click, some
 * text to read, and a clock that keeps it repainting (a still page sends no screencast
 * frames).
 */
export const TEST_PAGE_TITLE = 'dsh-chrome test page';

export const TEST_PAGE_HTML = `<!doctype html>
<meta charset="utf-8">
<title>${TEST_PAGE_TITLE}</title>
<body style="margin:0;background:#fff">
<input id="field" aria-label="Field" style="position:absolute;left:20px;top:20px;width:200px;height:30px">
<p id="clock" style="position:absolute;left:20px;top:80px">0</p>
<button id="go" style="position:absolute;left:20px;top:140px" onclick="this.textContent = 'Clicked'">Go</button>
<p style="position:absolute;left:20px;top:200px">A shared page for testing.</p>
<script>
  let ticks = 0;
  setInterval(() => { document.getElementById('clock').textContent = String(++ticks); }, 50);
</script>
</body>`;
