export function element(tag, options = {}, children = []) {
  const svgTags = new Set(['svg', 'line', 'text', 'polyline', 'circle', 'title']);
  const node = svgTags.has(tag)
    ? document.createElementNS('http://www.w3.org/2000/svg', tag)
    : document.createElement(tag);
  const isSvg = node.namespaceURI === 'http://www.w3.org/2000/svg';
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'className') isSvg ? node.setAttribute('class', value) : node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (!isSvg && key in node && !key.startsWith('aria')) node[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [children].flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

function appendLinkedText(container, text) {
  const urlPattern = /(https?:\/\/[^\s<]+)/g;
  let cursor = 0;
  for (const match of text.matchAll(urlPattern)) {
    if (match.index > cursor) container.append(document.createTextNode(text.slice(cursor, match.index)));
    let href = match[0];
    const trailing = href.match(/[),.;]+$/)?.[0] || '';
    if (trailing) href = href.slice(0, -trailing.length);
    container.append(element('a', { href, target: '_blank', rel: 'noopener noreferrer', text: href }));
    if (trailing) container.append(document.createTextNode(trailing));
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) container.append(document.createTextNode(text.slice(cursor)));
}

function safeImageSource(value) {
  try {
    const url = new URL(value, location.href);
    return ['http:', 'https:', 'data:', 'blob:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function renderRichText(container, value, assetUrls = new Map()) {
  container.classList.add('rich-text');
  const text = String(value || '');
  const tokenPattern = /!\[\[([^\]]+)\]\]|!\[([^\]]*)\]\(([^)]+)\)|<img\s+[^>]*src=["']([^"']+)["'][^>]*>|<br\s*\/?>/gi;
  let cursor = 0;

  for (const match of text.matchAll(tokenPattern)) {
    if (match.index > cursor) appendLinkedText(container, text.slice(cursor, match.index));
    if (/^<br/i.test(match[0])) {
      container.append(document.createElement('br'));
    } else {
      const assetName = match[1]?.trim();
      const source = assetName ? assetUrls.get(assetName) : (match[3] || match[4]);
      const safeSource = source && safeImageSource(source);
      if (safeSource) {
        container.append(element('img', { src: safeSource, alt: match[2] || assetName || 'Question illustration', loading: 'lazy' }));
      } else {
        container.append(element('span', { className: 'notice notice-warning', text: assetName ? `Missing image: ${assetName}` : 'Unsupported image' }));
      }
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) appendLinkedText(container, text.slice(cursor));
  return container;
}

export function pageHeader(title, description, action) {
  const copy = element('div', {}, [
    element('h1', { text: title }),
    description ? element('p', { className: 'lede', text: description }) : null
  ]);
  return element('header', { className: 'page-header' }, [copy, action]);
}

export function showToast(message, duration = 3500) {
  const region = document.getElementById('toastRegion');
  const toast = element('div', { className: 'toast', role: 'status', text: message });
  region.append(toast);
  window.setTimeout(() => toast.remove(), duration);
}

export function confirmAction({ title, message, confirmLabel = 'Confirm' }) {
  const dialog = document.getElementById('confirmDialog');
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  document.getElementById('confirmAction').textContent = confirmLabel;
  dialog.showModal();
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
  });
}

export function scoreChart(attempts) {
  const width = 640;
  const height = 190;
  const padding = 30;
  const svg = element('svg', { className: 'chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Score history chart' });
  for (const score of [0, 50, 100]) {
    const y = height - padding - ((score / 100) * (height - padding * 2));
    svg.append(element('line', { className: 'grid', x1: padding, x2: width - padding, y1: y, y2: y }));
    svg.append(element('text', { x: 2, y: y + 4, text: `${score}%` }));
  }
  if (!attempts.length) return svg;
  const usableWidth = width - padding * 2;
  const points = attempts.map((attempt, index) => {
    const x = attempts.length === 1 ? width / 2 : padding + (index / (attempts.length - 1)) * usableWidth;
    const y = height - padding - ((attempt.percent / 100) * (height - padding * 2));
    return { x, y, attempt };
  });
  svg.append(element('polyline', { className: 'line', points: points.map(point => `${point.x},${point.y}`).join(' ') }));
  for (const point of points) {
    const circle = element('circle', { className: 'point', cx: point.x, cy: point.y, r: 5 });
    circle.append(element('title', { text: `${point.attempt.percent}% on ${new Date(point.attempt.createdAt).toLocaleDateString()}` }));
    svg.append(circle);
  }
  return svg;
}
