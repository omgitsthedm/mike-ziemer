function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function hashSeed(str = '') {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function svgDataUri(svg) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function textLines(text = '', maxChars = 18, maxLines = 3) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return ['DeckSpace'];
  const lines = [];
  let current = '';
  while (words.length) {
    const word = words.shift();
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
    if (lines.length === maxLines - 1 && words.length) {
      current = `${current} ${words.join(' ')}`.trim();
      words.length = 0;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines).map((line, index, arr) => {
    if (index === arr.length - 1 && line.length > maxChars + 6) {
      return `${line.slice(0, maxChars + 3).trim()}...`;
    }
    return line;
  });
}

function eventPalette(seedText = '', category = '') {
  const rng = makeRng(hashSeed(`${seedText}|${category}|event-palette`));
  const palettes = [
    ['#0F2A5E', '#1F5DBA', '#FF6A00', '#FFE1C4', '#FFFFFF'],
    ['#1A2149', '#8944C7', '#FF7A45', '#FFD9F0', '#FFFFFF'],
    ['#0E3954', '#1AA4D8', '#FF6A00', '#FFE9C0', '#FFFFFF'],
    ['#301D5A', '#5E57C8', '#FF8652', '#FFE0C9', '#FFFFFF'],
    ['#16364A', '#2F8AC8', '#FF6B6B', '#FFF0D5', '#FFFFFF'],
  ];
  return pick(rng, palettes);
}

export function eventPosterDataUri({
  title = 'DeckSpace Event',
  category = 'social',
  kicker = 'DeckSpace Event',
  width = 240,
  height = 320,
  seed = '',
} = {}) {
  const [bgTop, bgBottom, accent, accentSoft, textColor] = eventPalette(seed || title, category);
  const lines = textLines(title, 16, 3);
  const categoryLabel = (category || 'Open Deck').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${bgTop}"/>
      <stop offset="100%" stop-color="${bgBottom}"/>
    </linearGradient>
    <linearGradient id="wave" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${accent}"/>
      <stop offset="100%" stop-color="${accentSoft}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <circle cx="${Math.round(width * 0.78)}" cy="${Math.round(height * 0.16)}" r="${Math.round(width * 0.17)}" fill="${accentSoft}" opacity="0.95"/>
  <circle cx="${Math.round(width * 0.24)}" cy="${Math.round(height * 0.23)}" r="${Math.round(width * 0.11)}" fill="${accent}" opacity="0.92"/>
  <path d="M0 ${Math.round(height * 0.67)} C ${Math.round(width * 0.18)} ${Math.round(height * 0.61)}, ${Math.round(width * 0.38)} ${Math.round(height * 0.73)}, ${Math.round(width * 0.56)} ${Math.round(height * 0.67)} S ${Math.round(width * 0.87)} ${Math.round(height * 0.61)}, ${width} ${Math.round(height * 0.7)} V ${height} H 0 Z" fill="url(#wave)"/>
  <path d="M0 ${Math.round(height * 0.79)} C ${Math.round(width * 0.22)} ${Math.round(height * 0.74)}, ${Math.round(width * 0.46)} ${Math.round(height * 0.85)}, ${Math.round(width * 0.67)} ${Math.round(height * 0.8)} S ${Math.round(width * 0.9)} ${Math.round(height * 0.76)}, ${width} ${Math.round(height * 0.82)} V ${height} H 0 Z" fill="${accent}" opacity="0.88"/>
  <rect x="16" y="18" width="${Math.round(width * 0.56)}" height="26" rx="13" fill="rgba(255,255,255,0.14)"/>
  <text x="30" y="35" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="700" fill="${textColor}" letter-spacing="1.2">${escapeXml(String(kicker).toUpperCase())}</text>
  <g transform="translate(18 92)">
    ${lines.map((line, index) => `<text x="0" y="${index * 30}" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700" fill="${textColor}">${escapeXml(line)}</text>`).join('')}
  </g>
  <rect x="18" y="${height - 64}" width="${Math.round(width * 0.5)}" height="24" fill="rgba(10,17,37,0.38)"/>
  <text x="30" y="${height - 48}" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="700" fill="${textColor}" letter-spacing="1.3">${escapeXml(categoryLabel)}</text>
  <text x="18" y="${height - 18}" font-family="Arial, Helvetica, sans-serif" font-size="12" fill="${textColor}" opacity="0.85">DECKSPACE</text>
</svg>`;
  return svgDataUri(svg);
}

export function voyageSceneDataUri({
  portName = 'At Sea',
  dayType = 'sea',
  note = '',
  width = 720,
  height = 480,
  seed = '',
} = {}) {
  const rng = makeRng(hashSeed(`${seed}|${portName}|${dayType}|voyage-scene`));
  const skies = [
    ['#87CEFA', '#EAF5FF', '#0C7BC5'],
    ['#7AB2FF', '#F2F8FF', '#1752B0'],
    ['#FFB36B', '#FFF5D7', '#FF6A00'],
    ['#8ED4C7', '#F3FBFA', '#0D7F9B'],
  ];
  const [skyTop, skyBottom, sea] = pick(rng, skies);
  const sunX = Math.round(width * (0.18 + rng() * 0.6));
  const sunY = Math.round(height * (0.16 + rng() * 0.14));
  const sunR = Math.round(width * 0.065);
  const label = textLines(portName, 18, 2);
  const sub = note || (dayType === 'sea' ? 'Sea day' : dayType === 'port' ? 'Port day' : 'DeckSpace voyage');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(portName)}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${skyTop}"/>
      <stop offset="100%" stop-color="${skyBottom}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#sky)"/>
  <circle cx="${sunX}" cy="${sunY}" r="${sunR}" fill="rgba(255,244,190,0.95)"/>
  <path d="M0 ${Math.round(height * 0.62)} C ${Math.round(width * 0.22)} ${Math.round(height * 0.56)}, ${Math.round(width * 0.44)} ${Math.round(height * 0.68)}, ${Math.round(width * 0.67)} ${Math.round(height * 0.62)} S ${Math.round(width * 0.9)} ${Math.round(height * 0.57)}, ${width} ${Math.round(height * 0.64)} V ${height} H 0 Z" fill="${sea}"/>
  <path d="M0 ${Math.round(height * 0.73)} C ${Math.round(width * 0.19)} ${Math.round(height * 0.69)}, ${Math.round(width * 0.42)} ${Math.round(height * 0.79)}, ${Math.round(width * 0.64)} ${Math.round(height * 0.73)} S ${Math.round(width * 0.89)} ${Math.round(height * 0.69)}, ${width} ${Math.round(height * 0.76)} V ${height} H 0 Z" fill="rgba(255,255,255,0.16)"/>
  <rect x="28" y="28" width="${Math.round(width * 0.42)}" height="34" rx="17" fill="rgba(12,41,87,0.18)"/>
  <text x="48" y="50" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700" fill="#0F2A5E" letter-spacing="1.4">${escapeXml(String(dayType).toUpperCase())}</text>
  <g transform="translate(32 ${Math.round(height * 0.7)})">
    ${label.map((line, index) => `<text x="0" y="${index * 34}" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="#FFFFFF">${escapeXml(line)}</text>`).join('')}
  </g>
  <text x="32" y="${height - 26}" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="rgba(255,255,255,0.92)">${escapeXml(sub.slice(0, 56))}</text>
</svg>`;
  return svgDataUri(svg);
}

export function memoryPhotoDataUri({
  caption = 'DeckSpace memory',
  seed = '',
  width = 1200,
  height = 900,
} = {}) {
  const rng = makeRng(hashSeed(`${seed}|${caption}|memory-photo`));
  const palettes = [
    ['#102A5F', '#2E8CD1', '#FF6A00', '#F8E0B0'],
    ['#1A2149', '#5A52D5', '#FF7D58', '#FFD9D2'],
    ['#153A4B', '#1BA0CC', '#FF8A3D', '#E8F7FF'],
    ['#2B2058', '#8A5CF6', '#FF8F6B', '#FFE8D5'],
  ];
  const [bg, secondary, accent, soft] = pick(rng, palettes);
  const lines = textLines(caption, 26, 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(caption)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg}"/>
      <stop offset="100%" stop-color="${secondary}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <circle cx="${Math.round(width * 0.2)}" cy="${Math.round(height * 0.25)}" r="${Math.round(width * 0.09)}" fill="${soft}" opacity="0.92"/>
  <circle cx="${Math.round(width * 0.78)}" cy="${Math.round(height * 0.2)}" r="${Math.round(width * 0.07)}" fill="${accent}" opacity="0.9"/>
  <path d="M0 ${Math.round(height * 0.62)} C ${Math.round(width * 0.2)} ${Math.round(height * 0.55)}, ${Math.round(width * 0.42)} ${Math.round(height * 0.7)}, ${Math.round(width * 0.62)} ${Math.round(height * 0.64)} S ${Math.round(width * 0.88)} ${Math.round(height * 0.58)}, ${width} ${Math.round(height * 0.68)} V ${height} H 0 Z" fill="rgba(255,255,255,0.18)"/>
  <rect x="40" y="${height - 180}" width="${Math.round(width * 0.58)}" height="116" rx="20" fill="rgba(7,18,40,0.34)"/>
  <g transform="translate(64 ${height - 112})">
    ${lines.map((line, index) => `<text x="0" y="${index * 42}" font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="700" fill="#FFFFFF">${escapeXml(line)}</text>`).join('')}
  </g>
  <text x="64" y="${height - 34}" font-family="Arial, Helvetica, sans-serif" font-size="18" fill="rgba(255,255,255,0.9)">Shattered Shores demo memory</text>
</svg>`;
  return svgDataUri(svg);
}
