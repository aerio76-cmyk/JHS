// 用 Rough.js 幫指定卡片畫手繪感邊框（呼應 Acc. SE 案卷風），刻意只用在少數幾個
// 重點卡片（成長夥伴 hero、家長登入卡），其餘卡片維持乾淨的一般邊框，避免過度裝飾。

function drawRoughBorders() {
  if (!window.rough) return;

  document.querySelectorAll('.rough-border-svg').forEach((svg) => svg.remove());

  document.querySelectorAll('[data-rough]').forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    el.style.position = 'relative';
    el.style.zIndex = '0';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'rough-border-svg');
    svg.setAttribute('width', rect.width);
    svg.setAttribute('height', rect.height);
    svg.style.position = 'absolute';
    svg.style.inset = '0';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '-1';
    el.prepend(svg);

    const rc = rough.svg(svg);
    const node = rc.rectangle(3, 3, rect.width - 6, rect.height - 6, {
      stroke: '#A9743B',
      strokeWidth: 2.5,
      roughness: 1.8,
      fill: 'none',
    });
    svg.appendChild(node);
  });
}

window.addEventListener('load', drawRoughBorders);

let roughResizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(roughResizeTimer);
  roughResizeTimer = setTimeout(drawRoughBorders, 200);
});
