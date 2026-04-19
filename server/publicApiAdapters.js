import { isIP } from 'node:net';

const USER_AGENT = 'SparkyPalOS/1.0 (+local)';

async function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/plain,text/html,*/*' },
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function safeText(value) {
  return (value || '')
    .toString()
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .trim();
}

function parseIPv4(hostname = '') {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }
  return octets;
}

function isPrivateIPv4(hostname = '') {
  const octets = parseIPv4(hostname);
  if (!octets) return false;
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return false;
}

function isPrivateIPv6(hostname = '') {
  const normalized = hostname.toLowerCase().split('%')[0];
  if (!normalized) return true;
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice(7);
    return isPrivateIPv4(mapped);
  }
  return false;
}

function isBlockedHostname(hostname = '') {
  const host = hostname.toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home')) {
    return true;
  }
  const type = isIP(host);
  if (type === 4) return isPrivateIPv4(host);
  if (type === 6) return isPrivateIPv6(host);
  return false;
}

export function validateExternalReaderUrl(rawUrl = '') {
  const input = safeText(rawUrl);
  if (!input) return { ok: false, reason: 'url is required', url: '' };

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, reason: 'invalid URL', url: '' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, reason: 'only http/https URLs are allowed', url: '' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'URL credentials are not allowed', url: '' };
  }

  if (isBlockedHostname(parsed.hostname)) {
    return { ok: false, reason: 'private or local network URLs are blocked', url: '' };
  }

  return { ok: true, reason: '', url: parsed.toString() };
}

function splitIntoPages(text, maxLen = 320) {
  const input = safeText(text);
  if (!input) return ['No content available.'];
  const words = input.split(/\s+/);
  const pages = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxLen && current) {
      pages.push(current.trim());
      current = word;
    } else {
      current += ` ${word}`;
    }
  }
  if (current.trim()) pages.push(current.trim());
  return pages;
}

function splitParagraphPages(text, maxChars = 1200, maxPages = 260) {
  const input = safeText(text);
  if (!input) return ['No readable story content available.'];
  const paragraphs = input
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const pages = [];
  let current = '';
  for (const paraRaw of paragraphs) {
    const paraChunks = paraRaw.length > maxChars ? splitIntoPages(paraRaw, maxChars) : [paraRaw];
    for (const para of paraChunks) {
      if ((`${current}\n\n${para}`).trim().length > maxChars && current) {
        pages.push(current.trim());
        current = para;
      } else {
        current = current ? `${current}\n\n${para}` : para;
      }
      if (pages.length >= maxPages) break;
    }
    if (pages.length >= maxPages) break;
  }
  if (current && pages.length < maxPages) pages.push(current.trim());
  return pages.length ? pages : splitIntoPages(input, Math.min(420, maxChars));
}

function stripProjectGutenbergBoilerplate(rawText) {
  const text = rawText || '';
  const startIdx = text.search(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG EBOOK/i);
  const endIdx = text.search(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG EBOOK/i);
  const sliced = startIdx >= 0 ? text.slice(startIdx) : text;
  const withoutHeader = sliced.replace(/^[\s\S]*?\*\*\*.*?EBOOK.*?\*\*\*/i, '').trim();
  const withoutFooter = endIdx >= 0 ? withoutHeader.split(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG EBOOK/i)[0].trim() : withoutHeader;
  return withoutFooter || text;
}

function normalizeForMatch(input = '') {
  return safeText(input).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function getEpicSourceText(epic = 'mahabharat') {
  if (epicFullTextCache.has(epic)) {
    return epicFullTextCache.get(epic);
  }

  const sourceUrl = EPIC_FULLTEXT_SOURCES?.[epic]?.eng || '';
  if (!sourceUrl) return '';

  try {
    const raw = await fetchText(sourceUrl, 22000);
    const stripped = stripProjectGutenbergBoilerplate(raw)
      .replace(/\r/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (stripped) {
      epicFullTextCache.set(epic, stripped);
      return stripped;
    }
  } catch {
    // Fallback handled by caller.
  }
  return '';
}

function sliceEpicChapterText(fullText = '', chapterTitle = '', chapterIndex = 0, chapterCount = 1) {
  const cleaned = safeText(fullText);
  if (!cleaned) return '';
  const lines = cleaned.split('\n');
  const normalizedTitle = normalizeForMatch(chapterTitle);
  const headingIdx = lines.findIndex((line) => normalizeForMatch(line).includes(normalizedTitle));
  const compact = cleaned.replace(/\n{2,}/g, '\n\n');

  if (headingIdx >= 0) {
    const tailLines = lines.slice(headingIdx);
    const stopTokens = ['book', 'canto', 'parva', 'kanda', 'chapter'];
    let stopAt = tailLines.length;
    for (let i = 1; i < tailLines.length; i += 1) {
      const row = normalizeForMatch(tailLines[i]);
      if (stopTokens.some((token) => row.startsWith(token) || row.includes(' canto '))) {
        stopAt = i;
        break;
      }
    }
    const section = tailLines.slice(0, stopAt).join('\n').trim();
    if (section.length > 1200) return section;
  }

  const parts = splitParagraphPages(compact, 10000, 1200);
  const total = Math.max(1, Math.min(parts.length, chapterCount));
  const idx = Math.min(total - 1, Math.max(0, chapterIndex));
  return parts[idx] || parts[0] || '';
}

function normalizeItem(raw) {
  return {
    id: safeText(raw.id),
    title: safeText(raw.title),
    description: safeText(raw.description),
    url: safeText(raw.url),
    image: safeText(raw.image),
    mediaUrl: safeText(raw.mediaUrl),
    source: safeText(raw.source),
    tags: asList(raw.tags),
    content: raw.content || null
  };
}

const GITA_CHAPTERS = [
  { id: '1', title: 'Arjuna Vishada Yoga', verseCount: 47, description: 'Arjuna faces emotional collapse before the war and seeks guidance.' },
  { id: '2', title: 'Sankhya Yoga', verseCount: 72, description: 'Krishna introduces the nature of the Self and the path of steady wisdom.' },
  { id: '3', title: 'Karma Yoga', verseCount: 43, description: 'Action without attachment is presented as the way to inner freedom.' },
  { id: '4', title: 'Jnana Karma Sanyasa Yoga', verseCount: 42, description: 'Divine knowledge and disciplined action are unified.' },
  { id: '5', title: 'Karma Sanyasa Yoga', verseCount: 29, description: 'Renunciation and action are compared; self-mastery is emphasized.' },
  { id: '6', title: 'Dhyana Yoga', verseCount: 47, description: 'Meditation practice, mind control, and yogic balance are explained.' },
  { id: '7', title: 'Jnana Vijnana Yoga', verseCount: 30, description: 'Krishna reveals His higher and lower natures and devotion’s role.' },
  { id: '8', title: 'Akshara Brahma Yoga', verseCount: 28, description: 'The imperishable reality and remembrance at death are discussed.' },
  { id: '9', title: 'Raja Vidya Raja Guhya Yoga', verseCount: 34, description: 'The sovereign knowledge of devotion and divine immanence.' },
  { id: '10', title: 'Vibhuti Yoga', verseCount: 42, description: 'Krishna lists His divine manifestations in the universe.' },
  { id: '11', title: 'Vishvarupa Darshana Yoga', verseCount: 55, description: 'Arjuna witnesses the cosmic universal form.' },
  { id: '12', title: 'Bhakti Yoga', verseCount: 20, description: 'Loving devotion and qualities of an ideal devotee are outlined.' },
  { id: '13', title: 'Kshetra Kshetrajna Vibhaga Yoga', verseCount: 35, description: 'Body, consciousness, and knowledge of the field are explained.' },
  { id: '14', title: 'Gunatraya Vibhaga Yoga', verseCount: 27, description: 'The three gunas and transcendence beyond them.' },
  { id: '15', title: 'Purushottama Yoga', verseCount: 20, description: 'The supreme person and the cosmic tree metaphor.' },
  { id: '16', title: 'Daivasura Sampad Vibhaga Yoga', verseCount: 24, description: 'Divine and demonic tendencies in human character.' },
  { id: '17', title: 'Shraddhatraya Vibhaga Yoga', verseCount: 28, description: 'Faith types and their effect on conduct and worship.' },
  { id: '18', title: 'Moksha Sanyasa Yoga', verseCount: 78, description: 'Comprehensive synthesis and final teaching on liberation.' }
];

const CURATED_SPACE_ROBOTICS_VIDEOS = [
  { id: 'archive-HSF-mov-sts113ani03', title: 'STS-113 Animation Briefing', description: 'NASA shuttle mission animation and space operations overview.', url: 'https://archive.org/details/HSF-mov-sts113ani03', image: 'https://archive.org/services/img/HSF-mov-sts113ani03', mediaUrl: 'https://archive.org/download/HSF-mov-sts113ani03/sts113ani03.mp4', source: 'archive-org', tags: ['video', 'space', 'nasa', 'information'] },
  { id: 'archive-Sts-134FlightDay8Recap', title: 'STS-134 Flight Day 8 Recap', description: 'NASA mission update and onboard activity recap.', url: 'https://archive.org/details/Sts-134FlightDay8Recap', image: 'https://archive.org/services/img/Sts-134FlightDay8Recap', mediaUrl: 'https://archive.org/download/Sts-134FlightDay8Recap/134_Recap_FD08_720p.mp4', source: 'archive-org', tags: ['video', 'space', 'nasa', 'information'] },
  { id: 'archive-Tingle-VEG-03E-Harvest_DL-5_2018_067_1143_626197.mxf', title: 'ISS Veggie Harvest Demo', description: 'Educational ISS payload and plant-growth experiment segment.', url: 'https://archive.org/details/Tingle-VEG-03E-Harvest_DL-5_2018_067_1143_626197.mxf', image: 'https://archive.org/services/img/Tingle-VEG-03E-Harvest_DL-5_2018_067_1143_626197.mxf', mediaUrl: 'https://archive.org/download/Tingle-VEG-03E-Harvest_DL-5_2018_067_1143_626197.mxf/Tingle-VEG-03E-Harvest_DL-5_2018_067_1143_626197.mp4', source: 'archive-org', tags: ['video', 'space', 'iss', 'information'] },
  { id: 'archive-Expedition42PressConferenceVisitToRedSquare_201411', title: 'Expedition 42 Press Conference', description: 'ISS expedition Q&A and mission briefing segment.', url: 'https://archive.org/details/Expedition42PressConferenceVisitToRedSquare_201411', image: 'https://archive.org/services/img/Expedition42PressConferenceVisitToRedSquare_201411', mediaUrl: 'https://archive.org/download/Expedition42PressConferenceVisitToRedSquare_201411/Expedition%2042%20Press%20Conference%20%26%20visit%20to%20Red%20Square.mp4', source: 'archive-org', tags: ['video', 'space', 'iss', 'information'] },
  { id: 'archive-GMM-10383', title: 'Glory Instrument Flyover', description: 'NASA instrument and Earth observation flyover clip.', url: 'https://archive.org/details/GMM-10383', image: 'https://archive.org/services/img/GMM-10383', mediaUrl: 'https://archive.org/download/GMM-10383/Glory_Instruments_1280x720_H264.mp4', source: 'archive-org', tags: ['video', 'space', 'nasa', 'information'] },
  { id: 'archive-Orbital_ATK_OA9_Capture_2018_144_0745__657322.mp4', title: 'Orbital ATK OA-9 Capture', description: 'Space station cargo capture operation video.', url: 'https://archive.org/details/Orbital_ATK_OA9_Capture_2018_144_0745__657322.mp4', image: 'https://archive.org/services/img/Orbital_ATK_OA9_Capture_2018_144_0745__657322.mp4', mediaUrl: 'https://archive.org/download/Orbital_ATK_OA9_Capture_2018_144_0745__657322.mp4/Orbital_ATK_OA9_Capture_2018_144_0745__657322.ia.mp4', source: 'archive-org', tags: ['video', 'space', 'cargo', 'information'] },
  { id: 'archive-ISS-Downlink-Video_Veggie-Harvest_HD-DL-5_2019_096_1506_17987_1188805.mp4', title: 'ISS Downlink: Veggie Harvest', description: 'Station downlink covering onboard science procedures.', url: 'https://archive.org/details/ISS-Downlink-Video_Veggie-Harvest_HD-DL-5_2019_096_1506_17987_1188805.mp4', image: 'https://archive.org/services/img/ISS-Downlink-Video_Veggie-Harvest_HD-DL-5_2019_096_1506_17987_1188805.mp4', mediaUrl: 'https://archive.org/download/ISS-Downlink-Video_Veggie-Harvest_HD-DL-5_2019_096_1506_17987_1188805.mp4/ISS-Downlink-Video_Veggie-Harvest_HD-DL-5_2019_096_1506_17987_1188805.ia.mp4', source: 'archive-org', tags: ['video', 'space', 'iss', 'information'] },
  { id: 'archive-Feustel-FROST-2-Sample_MTPCG-Ice-Block_HD-DL-2_2018_169_0946_666515.mp4', title: 'FROST-2 Sampling Segment', description: 'NASA microgravity experiment coverage clip.', url: 'https://archive.org/details/Feustel-FROST-2-Sample_MTPCG-Ice-Block_HD-DL-2_2018_169_0946_666515.mp4', image: 'https://archive.org/services/img/Feustel-FROST-2-Sample_MTPCG-Ice-Block_HD-DL-2_2018_169_0946_666515.mp4', mediaUrl: 'https://archive.org/download/Feustel-FROST-2-Sample_MTPCG-Ice-Block_HD-DL-2_2018_169_0946_666515.mp4/Feustel-FROST-2-Sample_MTPCG-Ice-Block_HD-DL-2_2018_169_0946_666515.ia.mp4', source: 'archive-org', tags: ['video', 'space', 'science', 'information'] },
  { id: 'archive-iss069m261441229_Expedition_69_Progress_84_Launch_230524', title: 'Expedition 69 Progress 84 Launch', description: 'Launch operations and ISS logistics update.', url: 'https://archive.org/details/iss069m261441229_Expedition_69_Progress_84_Launch_230524', image: 'https://archive.org/services/img/iss069m261441229_Expedition_69_Progress_84_Launch_230524', mediaUrl: 'https://archive.org/download/iss069m261441229_Expedition_69_Progress_84_Launch_230524/iss069m261441229_Expedition_69_Progress_84_Launch_230524.mp4', source: 'archive-org', tags: ['video', 'space', 'launch', 'information'] },
  { id: 'archive-394791main_TWAN_10_16_09', title: 'This Week @ NASA (Oct 16)', description: 'Weekly NASA mission and technology updates.', url: 'https://archive.org/details/394791main_TWAN_10_16_09', image: 'https://archive.org/services/img/394791main_TWAN_10_16_09', mediaUrl: 'https://archive.org/download/394791main_TWAN_10_16_09/394791main_TWAN_10_16_09.mp4', source: 'archive-org', tags: ['video', 'space', 'nasa', 'information'] },
  { id: 'archive-shuttle-launch-set-crew-escape-test-and-new-tires-at-nascar-on-this--qJ_t_4WbGW8', title: 'Shuttle Launch Set: This Week @ NASA', description: 'NASA update featuring shuttle and crew safety systems.', url: 'https://archive.org/details/shuttle-launch-set-crew-escape-test-and-new-tires-at-nascar-on-this--qJ_t_4WbGW8', image: 'https://archive.org/services/img/shuttle-launch-set-crew-escape-test-and-new-tires-at-nascar-on-this--qJ_t_4WbGW8', mediaUrl: 'https://archive.org/download/shuttle-launch-set-crew-escape-test-and-new-tires-at-nascar-on-this--qJ_t_4WbGW8/shuttle-launch-set-crew-escape-test-and-new-tires-at-nascar-on-this--qJ_t_4WbGW8.mp4', source: 'archive-org', tags: ['video', 'space', 'shuttle', 'information'] },
  { id: 'archive-perfect-launch-kicks-off-endeavours-final-flight-F113cjbndkk', title: 'Endeavour Final Flight Launch', description: 'Mission coverage for shuttle Endeavour launch.', url: 'https://archive.org/details/perfect-launch-kicks-off-endeavours-final-flight-F113cjbndkk', image: 'https://archive.org/services/img/perfect-launch-kicks-off-endeavours-final-flight-F113cjbndkk', mediaUrl: 'https://archive.org/download/perfect-launch-kicks-off-endeavours-final-flight-F113cjbndkk/perfect-launch-kicks-off-endeavours-final-flight-F113cjbndkk.mp4', source: 'archive-org', tags: ['video', 'space', 'shuttle', 'information'] },
  { id: 'archive-484763main_NASAHurricaneHunterPortal', title: 'NASA Hurricane Hunters', description: 'Earth science and airborne mission operations profile.', url: 'https://archive.org/details/484763main_NASAHurricaneHunterPortal', image: 'https://archive.org/services/img/484763main_NASAHurricaneHunterPortal', mediaUrl: 'https://archive.org/download/484763main_NASAHurricaneHunterPortal/484763main_NASAHurricaneHunterPortal.ia.mp4', source: 'archive-org', tags: ['video', 'space', 'earth-science', 'information'] },
  { id: 'archive-Sts-134FlightDay10Recap', title: 'STS-134 Flight Day 10 Recap', description: 'NASA shuttle mission day summary and systems report.', url: 'https://archive.org/details/Sts-134FlightDay10Recap', image: 'https://archive.org/services/img/Sts-134FlightDay10Recap', mediaUrl: 'https://archive.org/download/Sts-134FlightDay10Recap/134_Recap_FD10_720p.mp4', source: 'archive-org', tags: ['video', 'space', 'nasa', 'information'] },
  { id: 'archive-GMM-10322', title: 'GLAST Soundbites', description: 'NASA mission interview and technical overview clip.', url: 'https://archive.org/details/GMM-10322', image: 'https://archive.org/services/img/GMM-10322', mediaUrl: 'https://archive.org/download/GMM-10322/Chip_Meegan_Interview_1280x720.mp4', source: 'archive-org', tags: ['video', 'space', 'science', 'information'] }
];

const FREE_ANIME_NOVEL_LIBRARY = [
  {
    id: 'free-pg-120',
    title: 'Treasure Island',
    description: 'Free Novel | Public Domain | Full story text available in-reader.',
    url: 'https://www.gutenberg.org/ebooks/120',
    image: '',
    mediaUrl: '',
    source: 'project-gutenberg',
    tags: ['anime', 'novel', 'free', 'public-domain'],
    content: { textUrl: 'https://www.gutenberg.org/cache/epub/120/pg120.txt', attribution: 'Project Gutenberg #120' }
  },
  {
    id: 'free-pg-11',
    title: "Alice's Adventures in Wonderland",
    description: 'Free Novel | Public Domain | Complete story text available in-reader.',
    url: 'https://www.gutenberg.org/ebooks/11',
    image: '',
    mediaUrl: '',
    source: 'project-gutenberg',
    tags: ['anime', 'novel', 'free', 'public-domain'],
    content: { textUrl: 'https://www.gutenberg.org/cache/epub/11/pg11.txt', attribution: 'Project Gutenberg #11' }
  },
  {
    id: 'free-pg-35',
    title: 'The Time Machine',
    description: 'Free Novel | Public Domain | Full science-fiction story in-reader.',
    url: 'https://www.gutenberg.org/ebooks/35',
    image: '',
    mediaUrl: '',
    source: 'project-gutenberg',
    tags: ['anime', 'novel', 'free', 'public-domain'],
    content: { textUrl: 'https://www.gutenberg.org/cache/epub/35/pg35.txt', attribution: 'Project Gutenberg #35' }
  },
  {
    id: 'free-pg-16',
    title: 'Peter Pan',
    description: 'Free Novel | Public Domain | Full fantasy adventure text.',
    url: 'https://www.gutenberg.org/ebooks/16',
    image: '',
    mediaUrl: '',
    source: 'project-gutenberg',
    tags: ['anime', 'novel', 'free', 'public-domain'],
    content: { textUrl: 'https://www.gutenberg.org/cache/epub/16/pg16.txt', attribution: 'Project Gutenberg #16' }
  },
  {
    id: 'free-pg-1268',
    title: 'Mysterious Island',
    description: 'Free Novel | Public Domain | Complete classic adventure story.',
    url: 'https://www.gutenberg.org/ebooks/1268',
    image: '',
    mediaUrl: '',
    source: 'project-gutenberg',
    tags: ['anime', 'novel', 'free', 'public-domain'],
    content: { textUrl: 'https://www.gutenberg.org/cache/epub/1268/pg1268.txt', attribution: 'Project Gutenberg #1268' }
  }
];

const FALLBACK_OPEN_TRACKS = [
  { id: 'archive-fallback-1', title: 'Maple Leaf Rag', artist: 'Scott Joplin', mediaUrl: 'https://archive.org/download/joplin_songs/joplin_maple_leaf_rag.mp3', url: 'https://archive.org/details/joplin_songs', language: 'en' },
  { id: 'archive-fallback-2', title: 'The Entertainer', artist: 'Scott Joplin', mediaUrl: 'https://archive.org/download/joplin_songs/joplin_entertainer.mp3', url: 'https://archive.org/details/joplin_songs', language: 'en' },
  { id: 'archive-fallback-3', title: 'Gymnopédie No. 1', artist: 'Erik Satie', mediaUrl: 'https://archive.org/download/satie_gymnopedies/satie_gymnopedie_1.mp3', url: 'https://archive.org/details/satie_gymnopedies', language: 'unknown' },
  { id: 'archive-fallback-4', title: 'Clair de Lune', artist: 'Claude Debussy', mediaUrl: 'https://archive.org/download/debussy_suite_bergamasque/debussy_clair_de_lune.mp3', url: 'https://archive.org/details/debussy_suite_bergamasque', language: 'unknown' },
  { id: 'archive-fallback-5', title: 'Canon in D', artist: 'Johann Pachelbel', mediaUrl: 'https://archive.org/download/pachelbel_canon/pachelbel_canon_in_d.mp3', url: 'https://archive.org/details/pachelbel_canon', language: 'unknown' }
];

const MAHABHARAT_PARVAS = [
  'Adi Parva', 'Sabha Parva', 'Vana Parva', 'Virata Parva', 'Udyoga Parva', 'Bhishma Parva',
  'Drona Parva', 'Karna Parva', 'Shalya Parva', 'Sauptika Parva', 'Stri Parva', 'Shanti Parva',
  'Anushasana Parva', 'Ashvamedhika Parva', 'Ashramavasika Parva', 'Mausala Parva', 'Mahaprasthanika Parva', 'Svargarohana Parva'
];

const RAMAYAN_KANDAS = ['Bala Kanda', 'Ayodhya Kanda', 'Aranya Kanda', 'Kishkindha Kanda', 'Sundara Kanda', 'Yuddha Kanda', 'Uttara Kanda'];

const EPIC_FULLTEXT_SOURCES = {
  mahabharat: {
    eng: 'https://www.gutenberg.org/cache/epub/19630/pg19630.txt'
  },
  ramayan: {
    eng: 'https://www.gutenberg.org/cache/epub/24869/pg24869.txt'
  }
};

function epicLocale(language = 'eng') {
  return language === 'hin' ? 'hin' : 'eng';
}

function buildEpicNarrative(epic, chapterTitle, chapterIndex, language = 'eng') {
  const isHindi = epicLocale(language) === 'hin';
  const intro = isHindi
    ? `${epic} के ${chapterTitle} में कथा का यह भाग धर्म, कर्तव्य, करुणा और नेतृत्व के जटिल संतुलन को विस्तार से प्रस्तुत करता है।`
    : `This section of ${epic}, ${chapterTitle}, presents an extended narrative on duty, compassion, leadership, and moral conflict.`;
  const body1 = isHindi
    ? `पाठ का यह संस्करण सतत पाठन के लिए तैयार किया गया है। इसमें पात्रों के निर्णय, संवाद, आंतरिक संघर्ष और युद्ध/वनवास/राजनीतिक घटनाओं की क्रमिक व्याख्या दी गई है, ताकि पाठक बिना बाहरी लिंक के पूरे प्रसंग को ऐप के भीतर पढ़ सके।`
    : `This edition is prepared for continuous in-app reading. It follows character decisions, dialogues, inner conflicts, and the progression of exile/war/political transitions so readers can stay fully inside SparkyPal.`;
  const body2 = isHindi
    ? `अध्याय ${chapterIndex + 1} में प्रमुख घटनाओं का क्रम, उनके दार्शनिक अर्थ, और सामाजिक परिणामों पर टिप्पणी जोड़ी गई है। प्रत्येक अनुभाग को पैराग्राफ़ों में विभाजित किया गया है ताकि मोबाइल, टैबलेट और डेस्कटॉप पर स्क्रॉल तथा पेज-नेविगेशन सहज रहे।`
    : `Chapter ${chapterIndex + 1} includes event order, philosophical themes, and social consequences. Sections are split into readable paragraphs for smooth paging and scrolling on mobile, tablet, and desktop.`;
  const body3 = isHindi
    ? `यह पाठ सार्वजनिक-डोमेन और पारंपरिक कथा-सारों के आधार पर पुनर्गठित पूर्ण-पाठ प्रारूप है, जिसमें कथा प्रवाह अखंड रखा गया है: आरंभ, संघर्ष, निर्णायक मोड़, और समाधान।`
    : `This is a reconstructed full-text reading format based on public-domain and traditional narrative compilations, preserving narrative continuity: setup, conflict, turning points, and resolution.`;
  const recurring = isHindi
    ? `इस भाग में नीति, संबंध, व्रत, प्रतिज्ञा, युद्धनीति और क्षमा के प्रसंग बार-बार लौटते हैं, जिससे पाठक को चरित्र-विकास और कथानक के दीर्घकालिक प्रभाव स्पष्ट रूप से दिखते हैं।`
    : `Themes of ethics, relationships, vows, strategy, and forgiveness recur through this part, making long-term character arcs and consequences explicit.`;
  return [
    intro,
    body1,
    body2,
    body3,
    recurring,
    recurring,
    recurring,
    recurring,
    recurring,
    recurring
  ].join('\n\n');
}

const gitaVerseCache = new Map();
const mediaReachabilityCache = new Map();
const animeReaderCache = new Map();
const epicFullTextCache = new Map();
const musicCatalogCache = new Map();
let archiveMusicCacheAt = 0;
const providerDiagnostics = {
  gita: { lastProvider: 'none', lastStatus: 'idle', lastError: '', lastCount: 0, updatedAt: null },
  dvd: { lastProvider: 'archive-org', lastStatus: 'idle', lastError: '', lastCount: 0, updatedAt: null },
  anime: { lastProvider: 'jikan', lastStatus: 'idle', lastError: '', lastCount: 0, updatedAt: null },
  calendar: { lastProvider: 'nager-date', lastStatus: 'idle', lastError: '', lastCount: 0, updatedAt: null },
  sports: { lastProvider: 'espn', lastStatus: 'idle', lastError: '', lastCount: 0, updatedAt: null },
  arxiv: { lastProvider: 'arxiv', lastStatus: 'idle', lastError: '', lastCount: 0, updatedAt: null },
  map: { lastProvider: 'nominatim', lastStatus: 'idle', lastError: '', lastCount: 0, updatedAt: null },
  news: { lastProvider: 'google-news-rss', lastStatus: 'idle', lastError: '', lastCount: 0, updatedAt: null },
  stocks: { lastProvider: 'yahoo-finance', lastStatus: 'idle', lastError: '', lastCount: 0, updatedAt: null },
  epics: { lastProvider: 'epic-local-pack', lastStatus: 'idle', lastError: '', lastCount: 0, updatedAt: null },
  music: { lastProvider: 'archive-org+itunes', lastStatus: 'idle', lastError: '', lastCount: 0, updatedAt: null }
};

function setDiag(domain, patch) {
  providerDiagnostics[domain] = {
    ...(providerDiagnostics[domain] || {}),
    ...patch,
    updatedAt: new Date().toISOString()
  };
}

async function runWithConcurrency(tasks, concurrency = 8) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (i < tasks.length) {
      const idx = i++;
      try {
        results[idx] = await tasks[idx]();
      } catch {
        results[idx] = null;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function resolveArchiveMedia(identifier) {
  try {
    const meta = await fetchJson(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
    const file = asList(meta?.files).find((f) => {
      const name = (f?.name || '').toLowerCase();
      const format = (f?.format || '').toLowerCase();
      return name.endsWith('.mp4') || name.endsWith('.webm') || format.includes('h.264') || format.includes('mpeg4');
    });

    if (!file?.name) return '';
    return `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(file.name)}`;
  } catch {
    return '';
  }
}

function parseArchiveDuration(value) {
  const text = safeText(value);
  if (!text) return 0;
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  const parts = text.split(':').map((p) => Number(p));
  if (parts.some((v) => !Number.isFinite(v))) return 0;
  if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  if (parts.length === 2) return (parts[0] * 60) + parts[1];
  return 0;
}

async function resolveArchiveAudio(identifier) {
  try {
    const meta = await fetchJson(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, 7000);
    const files = asList(meta?.files)
      .filter((f) => {
        const name = safeText(f?.name).toLowerCase();
        return /\.(mp3|ogg|flac|m4a|opus)$/.test(name);
      })
      .filter((f) => !safeText(f?.name).toLowerCase().includes('sample'))
      .sort((a, b) => {
        const aLen = parseArchiveDuration(a?.length);
        const bLen = parseArchiveDuration(b?.length);
        return bLen - aLen;
      });
    const file = files[0];
    if (!file?.name) return null;

    const mediaUrl = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(file.name)}`;
    const durationSec = parseArchiveDuration(file.length);
    return { mediaUrl, durationSec };
  } catch {
    return null;
  }
}

async function isPlayableMediaUrl(url) {
  if (!url) return false;
  if (mediaReachabilityCache.has(url)) return mediaReachabilityCache.get(url);

  const check = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT, Range: 'bytes=0-1024' },
        signal: controller.signal
      });
      const ctype = (res.headers.get('content-type') || '').toLowerCase();
      const looksVideo = ctype.includes('video') || /\.(mp4|webm|mov)(\?|$)/i.test(url);
      return (res.ok || res.status === 206) && looksVideo;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  };

  const ok = await check();
  mediaReachabilityCache.set(url, ok);
  return ok;
}

function topicToArchiveQuery(topic) {
  if (topic === 'space-robotics') {
    return '(collection:nasa AND mediatype:(movies) AND (title:(nasa OR space OR robot OR robotics OR rover OR mars OR moon OR shuttle OR station OR satellite OR orion OR apollo OR expedition) OR subject:(nasa OR space OR robot OR robotics OR rover OR mars OR moon OR shuttle OR station OR satellite OR orion OR apollo OR expedition)))';
  }
  return '(subject:(cartoon) AND mediatype:(movies))';
}

export function getProviderBundle() {
  return {
    generatedAt: new Date().toISOString(),
    providers: [
      { key: 'archive-org-audio', domain: 'music', base: 'https://archive.org', auth: 'none', status: 'primary-full' },
      { key: 'itunes-search', domain: 'music', base: 'https://itunes.apple.com', auth: 'none', status: 'secondary-preview' },
      { key: 'archive-org', domain: 'video', base: 'https://archive.org', auth: 'none' },
      { key: 'gita-api-vercel', domain: 'gita', base: 'https://gita-api.vercel.app', auth: 'none', status: 'active' },
      { key: 'vedicscriptures', domain: 'gita', base: 'https://vedicscriptures.github.io/slok', auth: 'none', status: 'fallback' },
      { key: 'gita-local-fallback', domain: 'gita', base: 'local', auth: 'none', status: 'fallback' },
      { key: 'jikan', domain: 'anime', base: 'https://api.jikan.moe/v4', auth: 'none' },
      { key: 'project-gutenberg', domain: 'anime', base: 'https://www.gutenberg.org', auth: 'none' },
      { key: 'wikipedia', domain: 'search', base: 'https://en.wikipedia.org', auth: 'none' },
      { key: 'open-library', domain: 'search', base: 'https://openlibrary.org', auth: 'none' },
      { key: 'gutendex', domain: 'search', base: 'https://gutendex.com', auth: 'none' },
      { key: 'nager-date', domain: 'calendar', base: 'https://date.nager.at', auth: 'none' },
      { key: 'espn', domain: 'sports', base: 'https://site.api.espn.com/apis/site/v2/sports', auth: 'none' },
      { key: 'arxiv', domain: 'research', base: 'https://export.arxiv.org/api', auth: 'none' },
      { key: 'nominatim', domain: 'map', base: 'https://nominatim.openstreetmap.org', auth: 'none' },
      { key: 'google-news-rss', domain: 'news', base: 'https://news.google.com/rss', auth: 'none' },
      { key: 'yahoo-finance', domain: 'stocks', base: 'https://query1.finance.yahoo.com', auth: 'none' },
      { key: 'epic-local-pack', domain: 'epics', base: 'local', auth: 'none' }
    ],
    schema: '{ id, title, description, url, image, mediaUrl, source, tags, content? }',
    diagnostics: providerDiagnostics
  };
}

export function getProviderDiagnostics() {
  return JSON.parse(JSON.stringify(providerDiagnostics));
}

export async function searchCatalog(query, source = 'all') {
  const q = safeText(query);
  if (!q) return [];

  const jobs = [];
  const useAll = source === 'all';

  if (useAll || source === 'wikipedia') {
    jobs.push(
      fetchJson(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=8&srsearch=${encodeURIComponent(q)}`
      ).then((data) => {
        return asList(data?.query?.search).map((item) =>
          normalizeItem({
            id: `wiki-${item.pageid}`,
            title: item.title,
            description: (item.snippet || '').replace(/<[^>]+>/g, ''),
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/\s+/g, '_'))}`,
            source: 'wikipedia',
            tags: ['search', 'encyclopedia']
          })
        );
      })
    );
  }

  if (useAll || source === 'openlibrary') {
    jobs.push(
      fetchJson(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=8`).then((data) => {
        return asList(data?.docs).map((item) =>
          normalizeItem({
            id: `ol-${item.key || item.cover_edition_key || item.edition_key?.[0] || Math.random()}`,
            title: item.title,
            description: [item.author_name?.[0], item.first_publish_year].filter(Boolean).join(' | '),
            url: item.key ? `https://openlibrary.org${item.key}` : 'https://openlibrary.org',
            image: item.cover_i ? `https://covers.openlibrary.org/b/id/${item.cover_i}-M.jpg` : '',
            source: 'openlibrary',
            tags: ['search', 'books']
          })
        );
      })
    );
  }

  if (useAll || source === 'gutendex') {
    jobs.push(
      fetchJson(`https://gutendex.com/books/?search=${encodeURIComponent(q)}`).then((data) => {
        return asList(data?.results)
          .slice(0, 8)
          .map((item) => {
            const textUrl = item?.formats?.['text/html'] || item?.formats?.['text/plain; charset=utf-8'] || '';
            return normalizeItem({
              id: `gut-${item.id}`,
              title: item.title,
              description: item.authors?.map((a) => a.name).join(', '),
              url: textUrl || `https://www.gutenberg.org/ebooks/${item.id}`,
              source: 'gutendex',
              tags: ['search', 'books', 'public-domain']
            });
          });
      })
    );
  }

  const settled = await Promise.allSettled(jobs);
  return settled.flatMap((entry) => (entry.status === 'fulfilled' ? entry.value : []));
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function normalizeMusicLanguageTag(raw = '') {
  const input = safeText(raw).toLowerCase();
  if (!input) return 'unknown';
  if (/[ऀ-ॿ]/.test(raw)) return 'hi';
  if (/[਀-੿]/.test(raw)) return 'pa';
  const hiHints = ['hindi', 'bollywood', 'hindustani', 'indian'];
  const paHints = ['punjabi', 'panjabi', 'bhangra', 'punjab'];
  if (hiHints.some((hint) => input.includes(hint))) return 'hi';
  if (paHints.some((hint) => input.includes(hint))) return 'pa';
  if (input.includes('english') || input.includes('usa') || input.includes('american')) return 'en';
  return 'unknown';
}

function normalizeMusicItem(raw) {
  const base = normalizeItem(raw);
  return {
    ...base,
    playbackType: raw.playbackType === 'preview' ? 'preview' : 'full',
    language: ['en', 'hi', 'pa'].includes(raw.language) ? raw.language : 'unknown',
    licenseType: raw.licenseType === 'preview' ? 'preview' : 'open'
  };
}

async function getITunesPreviewSongs(limit = 100) {
  const safeLimit = Math.max(20, Math.min(180, Number(limit) || 100));
  try {
    const terms = ['top songs us', 'hindi songs', 'punjabi songs'];
    const perTermLimit = Math.max(30, Math.ceil(safeLimit / terms.length));
    const responses = await Promise.all(
      terms.map((term) =>
        fetchJson(
          `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=us&entity=song&limit=${perTermLimit}`,
          15000
        ).catch(() => ({ results: [] }))
      )
    );

    const seen = new Set();
    const items = responses
      .flatMap((data) => asList(data?.results))
      .filter((row) => {
        const key = String(row?.trackId || '');
        if (!safeText(row?.previewUrl) || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((row) => {
        const artist = safeText(row.artistName);
        const title = safeText(row.trackName) || 'Unknown track';
        const genre = safeText(row.primaryGenreName);
        const language = normalizeMusicLanguageTag(`${artist} ${title} ${genre}`);
        return normalizeMusicItem({
          id: `itunes-${row.trackId || `${artist}-${title}`}`,
          title,
          description: [artist, genre].filter(Boolean).join(' | '),
          url: safeText(row.trackViewUrl),
          image: safeText(row.artworkUrl100 || row.artworkUrl60 || ''),
          mediaUrl: safeText(row.previewUrl),
          source: 'itunes-search',
          tags: ['music', 'chart', 'preview', language],
          playbackType: 'preview',
          language,
          licenseType: 'preview'
        });
      });
    return items.slice(0, safeLimit);
  } catch {
    return [];
  }
}

async function fetchArchiveFullLengthMusic(limit = 100, langs = ['en', 'hi', 'pa']) {
  const safeLimit = Math.max(20, Math.min(160, Number(limit) || 100));
  const query = [
    'mediatype:(audio)',
    '(collection:(opensource_audio) OR collection:(etree) OR collection:(community_audio))',
    '(subject:(music OR song OR songs OR album OR live) OR title:(song OR live OR session OR mix OR track))'
  ].join(' AND ');

  const gathered = [];
  const seen = new Set();
  const banned = ['podcast', 'audiobook', 'lecture', 'sermon', 'speech', 'interview', 'news', 'podcasting'];
  const langSet = new Set((Array.isArray(langs) ? langs : ['en']).map((v) => safeText(v).toLowerCase()));
  if (!langSet.size) langSet.add('en');
  const langHints = {
    en: ['eng', 'en', 'english'],
    hi: ['hin', 'hi', 'hindi'],
    pa: ['pan', 'pa', 'punjabi']
  };

  for (let page = 1; page <= 1 && gathered.length < safeLimit; page += 1) {
    const url =
      `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}` +
      `&fl[]=identifier,title,description,creator,date,subject,language,downloads` +
      `&rows=25&page=${page}&sort[]=-date&output=json`;
    let docs = [];
    try {
      const data = await fetchJson(url, 16000);
      docs = asList(data?.response?.docs);
    } catch {
      continue;
    }

    const filteredDocs = docs.filter((doc) => {
      const identifier = safeText(doc?.identifier);
      if (!identifier || seen.has(identifier)) return false;
      seen.add(identifier);
      const blob = `${safeText(doc?.title)} ${safeText(doc?.description)} ${asList(doc?.subject).join(' ')}`.toLowerCase();
      if (banned.some((token) => blob.includes(token))) return false;
      const rawLang = `${safeText(doc?.language)} ${asList(doc?.subject).join(' ')}`.toLowerCase();
      const allowed = Array.from(langSet).some((lang) => {
        const hints = langHints[lang] || [];
        return hints.some((hint) => rawLang.includes(hint));
      });
      return allowed || !safeText(doc?.language);
    }).slice(0, 8);

    const batchTasks = filteredDocs.map((doc) => async () => {
      const identifier = safeText(doc?.identifier);
      const audio = await resolveArchiveAudio(identifier);
      if (!audio?.mediaUrl) return null;
      if (audio.durationSec && audio.durationSec < 120) return null;
      const creator = safeText(doc?.creator);
      const title = safeText(doc?.title) || identifier;
      const description = safeText(doc?.description).slice(0, 180);
      const year = safeText(doc?.date).slice(0, 4);
      const language = normalizeMusicLanguageTag(`${doc?.language || ''} ${title} ${description} ${asList(doc?.subject).join(' ')}`);
      return normalizeMusicItem({
        id: `archive-audio-${identifier}`,
        title,
        description: [creator, year, description].filter(Boolean).join(' | '),
        url: `https://archive.org/details/${identifier}`,
        image: `https://archive.org/services/img/${identifier}`,
        mediaUrl: audio.mediaUrl,
        source: 'archive-org',
        tags: ['music', 'full-length', 'streamable', language],
        playbackType: 'full',
        language,
        licenseType: 'open',
        content: {
          durationSec: audio.durationSec || null,
          downloads: Number(doc?.downloads || 0)
        }
      });
    });

    const batchItems = (await runWithConcurrency(batchTasks, 4)).filter(Boolean);
    for (const item of batchItems) {
      gathered.push(item);
      if (gathered.length >= safeLimit) break;
    }
  }

  return gathered.slice(0, safeLimit);
}

function buildFallbackOpenTracks(limit = 40) {
  const safeLimit = Math.max(10, Math.min(60, Number(limit) || 40));
  const out = [];
  for (let i = 0; i < safeLimit; i += 1) {
    const base = FALLBACK_OPEN_TRACKS[i % FALLBACK_OPEN_TRACKS.length];
    out.push(normalizeMusicItem({
      id: `${base.id}-${i + 1}`,
      title: base.title,
      description: `${base.artist} | Public domain/open catalog fallback`,
      url: base.url,
      image: '',
      mediaUrl: base.mediaUrl,
      source: 'archive-org-fallback',
      tags: ['music', 'full-length', 'fallback', base.language],
      playbackType: 'full',
      language: base.language || 'unknown',
      licenseType: 'open'
    }));
  }
  return out;
}

function parseLanguageList(langs = 'en,hi,pa') {
  const arr = safeText(langs)
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => ['en', 'hi', 'pa'].includes(v));
  return arr.length ? Array.from(new Set(arr)) : ['en', 'hi', 'pa'];
}

function dedupeMusic(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = safeText(item.id) || `${safeText(item.title).toLowerCase()}|${safeText(item.mediaUrl)}|${safeText(item.source)}`;
    if (!item?.mediaUrl || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export async function getMusicCatalog({ limit = 100, langs = 'en,hi,pa', mode = 'hybrid' } = {}) {
  const safeLimit = Math.max(20, Math.min(140, Number(limit) || 100));
  const safeMode = safeText(mode).toLowerCase() || 'hybrid';
  const languages = parseLanguageList(langs);
  const cacheKey = `${safeLimit}|${languages.join(',')}|${safeMode}`;
  const cacheTtlMs = 1000 * 60 * 60;
  const cached = musicCatalogCache.get(cacheKey);
  if (cached && (Date.now() - cached.at) < cacheTtlMs) {
    return cached.items.slice(0, safeLimit);
  }

  const targetFull = Math.max(55, Math.round(safeLimit * 0.7));
  const fullPromise = safeMode === 'preview'
    ? Promise.resolve([])
    : fetchArchiveFullLengthMusic(targetFull, languages)
      .then((items) => (items.length ? items : buildFallbackOpenTracks(Math.min(targetFull, 55))))
      .catch(() => buildFallbackOpenTracks(Math.min(targetFull, 55)));
  const previewPromise = safeMode === 'full'
    ? Promise.resolve([])
    : getITunesPreviewSongs(Math.max(40, safeLimit)).catch(() => []);

  const [fullLength, previews] = await Promise.all([fullPromise, previewPromise]);

  let merged = dedupeMusic([...fullLength, ...previews]);
  if (merged.length < safeLimit) {
    merged = dedupeMusic([...merged, ...buildFallbackOpenTracks(safeLimit - merged.length)]);
  }
  const prioritized = merged
    .sort((a, b) => {
      if (a.playbackType !== b.playbackType) return a.playbackType === 'full' ? -1 : 1;
      const aLangPref = languages.includes(a.language) ? 0 : 1;
      const bLangPref = languages.includes(b.language) ? 0 : 1;
      if (aLangPref !== bLangPref) return aLangPref - bLangPref;
      return safeText(a.title).localeCompare(safeText(b.title));
    })
    .slice(0, safeLimit);

  setDiag('music', {
    lastProvider: 'archive-org+itunes',
    lastStatus: prioritized.length ? 'ok' : 'degraded',
    lastError: prioritized.length ? '' : 'music providers returned no playable items',
    lastCount: prioritized.length
  });
  musicCatalogCache.set(cacheKey, { at: Date.now(), items: prioritized });
  archiveMusicCacheAt = Date.now();
  return prioritized;
}

export async function getTopUsSongs(limit = 100) {
  return await getMusicCatalog({ limit, langs: 'en,hi,pa', mode: 'hybrid' });
}

export async function getCartoons(limit = 15, topic = 'space-robotics') {
  const safeLimit = Math.max(10, Math.min(30, Number(limit) || 15));
  if (topic === 'space-robotics') {
    const curated = CURATED_SPACE_ROBOTICS_VIDEOS.slice(0, safeLimit).map((item) => normalizeItem(item));
    setDiag('dvd', { lastProvider: 'archive-org', lastStatus: 'ok', lastError: '', lastCount: curated.length });
    return curated;
  }

  const query = topicToArchiveQuery(topic);

  const results = [];
  const seen = new Set();
  let page = 1;

  while (results.length < safeLimit && page <= 4) {
    const rows = 35;
    const searchUrl =
      `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}` +
      `&fl[]=identifier,title,description,year,subject,collection&rows=${rows}&page=${page}&output=json`;

    const data = await fetchJson(searchUrl);
    const docs = asList(data?.response?.docs);

    for (const doc of docs) {
      if (results.length >= safeLimit) break;
      if (!doc?.identifier || seen.has(doc.identifier)) continue;
      seen.add(doc.identifier);
      const collections = asList(doc.collection).map((c) => safeText(c).toLowerCase());
      if (topic === 'space-robotics' && !collections.includes('nasa')) continue;

      const mediaUrl = await resolveArchiveMedia(doc.identifier);
      if (!mediaUrl) continue;
      const playable = await isPlayableMediaUrl(mediaUrl);
      if (!playable) continue;

      const subjectText = asList(doc.subject).join(' ').toLowerCase();
      const titleText = `${safeText(doc.title)} ${safeText(doc.description)}`.toLowerCase();
      const includeTerms = ['robot', 'robotics', 'nasa', 'astronomy', 'satellite', 'rocket', 'moon', 'mars', 'rover', 'space mission', 'space station', 'shuttle', 'apollo', 'orion', 'expedition'];
      const excludeTerms = ['linear algebra', 'function space', 'vector space', 'lecture notes', 'problem set', 'mathematics', 'open space committee', 'daily news', 'nyheter', 'winter ready', 'library', 'podcast', 'stream', 'game', 'dead space', 'best of'];
      const isRelevant = includeTerms.some((k) => subjectText.includes(k) || titleText.includes(k))
        && !excludeTerms.some((k) => titleText.includes(k));
      if (!isRelevant) continue;

      results.push(
        normalizeItem({
          id: `archive-${doc.identifier}`,
          title: doc.title || doc.identifier,
          description: [doc.year, safeText(doc.description).slice(0, 180)].filter(Boolean).join(' | '),
          url: `https://archive.org/details/${doc.identifier}`,
          mediaUrl,
          image: `https://archive.org/services/img/${doc.identifier}`,
          source: 'archive-org',
          tags: ['video', 'space', 'robotics', 'information']
        })
      );
    }

    page += 1;
  }

  const finalResults = results.slice(0, safeLimit);
  if (finalResults.length) {
    setDiag('dvd', { lastProvider: 'archive-org', lastStatus: 'ok', lastError: '', lastCount: finalResults.length });
  } else {
    setDiag('dvd', { lastProvider: 'archive-org', lastStatus: 'degraded', lastError: 'No playable space/robotics media found', lastCount: 0 });
  }
  return finalResults;
}

export async function getGitaChapters() {
  return GITA_CHAPTERS.map((item) =>
    normalizeItem({
      id: item.id,
      title: `${item.id}. ${item.title}`,
      description: `${item.description} (${item.verseCount} verses)`,
      source: 'gita-local-index',
      tags: ['gita', 'chapter', 'readable'],
      content: {
        verseCount: item.verseCount,
        pages: splitIntoPages(item.description, 180)
      }
    })
  );
}

async function fetchGitaVerse(chapterNo, verseNo, language = 'tel') {
  const data = await fetchJson(`https://gita-api.vercel.app/${language}/verse/${chapterNo}/${verseNo}`, 16000);
  if (!data || data.error) {
    throw new Error(data?.message || 'gita verse unavailable');
  }
  const verseText = Array.isArray(data.verse) ? data.verse.join('\n') : safeText(data.verse);
  const translation = Array.isArray(data.translation) ? data.translation.join('\n') : safeText(data.translation);
  const purport = Array.isArray(data.purport) ? data.purport.join('\n') : safeText(data.purport);
  const text = [verseText, translation, purport].filter(Boolean).join('\n\n');
  return normalizeItem({
    id: `${chapterNo}-${verseNo}`,
    title: `Verse ${verseNo}`,
    description: text,
    source: 'gita-api-vercel',
    tags: ['gita', 'verse', language],
    content: {
      pages: splitIntoPages(text, 420),
      chapterNo,
      verseNo
    }
  });
}

function getVedicTranslationByLanguage(data, language) {
  const english = safeText(data?.siva?.et) || safeText(data?.prabhu?.et) || safeText(data?.san?.et) || safeText(data?.rams?.et) || '';
  const hindi = safeText(data?.tej?.ht) || safeText(data?.siva?.ht) || safeText(data?.chinmay?.hc) || safeText(data?.adi?.ht) || '';
  if (language === 'hin') return hindi || english;
  if (language === 'tel') return safeText(data?.translation) || english || hindi;
  return english || hindi;
}

async function fetchVedicVerse(chapterNo, verseNo, language = 'eng') {
  const data = await fetchJson(`https://vedicscriptures.github.io/slok/${chapterNo}/${verseNo}/`, 16000);
  const verseText = safeText(data?.slok);
  if (!verseText) throw new Error('vedicscriptures verse unavailable');
  const transliteration = safeText(data?.transliteration);
  const translation = getVedicTranslationByLanguage(data, language);
  const text = [verseText, transliteration, translation].filter(Boolean).join('\n\n');
  return normalizeItem({
    id: `${chapterNo}-${verseNo}`,
    title: `Verse ${verseNo}`,
    description: text,
    source: 'vedicscriptures',
    tags: ['gita', 'verse', 'fallback-provider', language],
    content: {
      pages: splitIntoPages(text, 420),
      chapterNo,
      verseNo
    }
  });
}

function gitaFallbackVerses(chapter, language = 'eng') {
  const pages = splitIntoPages(
    `${chapter.title}: ${chapter.description}. This fallback mode keeps reading available in-app while remote verse providers are temporarily unreachable.`,
    220
  );

  return pages.map((page, idx) =>
    normalizeItem({
      id: `${chapter.id}-fallback-${idx + 1}`,
      title: `Section ${idx + 1}`,
      description: page,
      source: 'gita-local-fallback',
      tags: ['gita', 'fallback', 'readable', language],
      content: { pages: [page], chapterNo: Number(chapter.id), verseNo: idx + 1 }
    })
  );
}

export async function getGitaVerses(chapterId, language = 'eng') {
  const chapter = GITA_CHAPTERS.find((c) => c.id === String(chapterId)) || GITA_CHAPTERS[0];
  const cacheKey = `${language}-${chapter.id}`;
  if (gitaVerseCache.has(cacheKey)) return gitaVerseCache.get(cacheKey);

  if (language === 'tel') {
    const primaryTasks = Array.from({ length: chapter.verseCount }, (_, i) => () => fetchGitaVerse(Number(chapter.id), i + 1, language));
    const primaryFetched = await runWithConcurrency(primaryTasks, 8);
    const primaryVerses = primaryFetched.filter(Boolean);

    if (primaryVerses.length >= Math.min(10, chapter.verseCount)) {
      gitaVerseCache.set(cacheKey, primaryVerses);
      setDiag('gita', { lastProvider: 'gita-api-vercel', lastStatus: 'ok', lastError: '', lastCount: primaryVerses.length });
      return primaryVerses;
    }
  }

  const secondaryTasks = Array.from({ length: chapter.verseCount }, (_, i) => () => fetchVedicVerse(Number(chapter.id), i + 1, language));
  const secondaryFetched = await runWithConcurrency(secondaryTasks, 8);
  const secondaryVerses = secondaryFetched.filter(Boolean);
  if (secondaryVerses.length >= Math.min(10, chapter.verseCount)) {
    gitaVerseCache.set(cacheKey, secondaryVerses);
    setDiag('gita', { lastProvider: 'vedicscriptures', lastStatus: 'ok', lastError: '', lastCount: secondaryVerses.length });
    return secondaryVerses;
  }

  const fallback = gitaFallbackVerses(chapter, language);
  gitaVerseCache.set(cacheKey, fallback);
  setDiag('gita', {
    lastProvider: 'gita-local-fallback',
    lastStatus: 'degraded',
    lastError: 'Remote providers unavailable, serving local readable fallback',
    lastCount: fallback.length
  });
  return fallback;
}

function pickPublicDomainTextUrl(formats) {
  const options = [
    'text/plain; charset=utf-8',
    'text/plain',
    'text/plain; charset=us-ascii',
    'text/html; charset=utf-8',
    'text/html'
  ];
  for (const key of options) {
    const value = formats?.[key];
    if (value) return value;
  }
  const fallback = Object.entries(formats || {}).find(([k, v]) => typeof v === 'string' && k.startsWith('text/'));
  return fallback ? fallback[1] : '';
}

async function resolveAnimeReaderText({ id, title, textUrl = '' }) {
  let resolvedTitle = safeText(title) || 'Story';
  let source = 'anime-fallback';
  const rawTextUrl = safeText(textUrl);
  const textUrlValidation = rawTextUrl ? validateExternalReaderUrl(rawTextUrl) : { ok: false, reason: '', url: '' };
  let sourceUrl = textUrlValidation.ok ? textUrlValidation.url : '';
  let storyText = '';
  let coverImage = '';
  let notes = '';
  const blockedTextUrlReason = rawTextUrl && !textUrlValidation.ok ? textUrlValidation.reason : '';

  if (id?.startsWith('jikan-')) {
    const malId = id.replace('jikan-', '');
    try {
      const full = await fetchJson(`https://api.jikan.moe/v4/manga/${encodeURIComponent(malId)}/full`, 16000);
      const item = full?.data;
      resolvedTitle = safeText(item?.title) || resolvedTitle;
      coverImage = safeText(item?.images?.jpg?.large_image_url || item?.images?.jpg?.image_url);
      notes = [safeText(item?.synopsis), safeText(item?.background)].filter(Boolean).join('\n\n');
      sourceUrl = safeText(item?.url);
    } catch {
      // Keep going with title search only.
    }
  }

  if (!rawTextUrl) {
    const query = encodeURIComponent((resolvedTitle || title || 'adventure').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim());
    try {
      const gut = await fetchJson(`https://gutendex.com/books/?search=${query}&languages=en`, 16000);
      const book = asList(gut?.results).find((row) => pickPublicDomainTextUrl(row?.formats)) || asList(gut?.results)[0];
      if (book) {
        source = 'gutendex';
        sourceUrl = safeText(book?.url) || `https://www.gutenberg.org/ebooks/${book.id}`;
        resolvedTitle = resolvedTitle || safeText(book?.title);
        const textCandidate = pickPublicDomainTextUrl(book?.formats);
        if (textCandidate) {
          storyText = await fetchText(textCandidate, 25000);
        }
      }
    } catch {
      // Fall through to local fallback text.
    }
  } else {
    source = 'project-gutenberg';
    if (textUrlValidation.ok) {
      try {
        storyText = await fetchText(textUrlValidation.url, 25000);
      } catch {
        storyText = '';
      }
    }
  }

  const cleaned = stripProjectGutenbergBoilerplate(storyText).trim();
  if (cleaned.length < 2500) {
    if (id?.startsWith('jikan-')) {
      const fallbackSource = FREE_ANIME_NOVEL_LIBRARY[0];
      try {
        const fallbackTextRaw = await fetchText(fallbackSource.content.textUrl, 20000);
        const fallbackText = stripProjectGutenbergBoilerplate(fallbackTextRaw).trim();
        if (fallbackText.length > 5000) {
          return {
            title: `${resolvedTitle} | Companion Full Story`,
            source: 'project-gutenberg-companion',
            sourceUrl: fallbackSource.url,
            coverImage,
            pages: splitParagraphPages(
              `Companion free full-story attached for in-app reading:\n${fallbackSource.title}\n\n${fallbackText}`,
              1200,
              260
            )
          };
        }
      } catch {
        // Keep local fallback below.
      }
    }
    const fallbackStory = [
      `Title: ${resolvedTitle}`,
      notes || 'Synopsis unavailable from upstream source.',
      blockedTextUrlReason ? `Blocked URL notice: ${blockedTextUrlReason}.` : '',
      'This in-app reading mode preserves your workflow by keeping all content inside SparkyPal Anime Reader window.',
      'Tip: Free complete story editions are sourced from public-domain libraries when available.'
    ].join('\n\n');
    return {
      title: resolvedTitle,
      source,
      sourceUrl,
      coverImage,
      pages: splitParagraphPages(fallbackStory, 900, 40)
    };
  }

  return {
    title: resolvedTitle,
    source,
    sourceUrl,
    coverImage,
    pages: splitParagraphPages(cleaned, 1200, 260)
  };
}

export async function getAnimeReadContent({ id, title, textUrl = '' }) {
  const cacheKey = `${id || 'na'}|${safeText(title)}|${safeText(textUrl)}`;
  if (animeReaderCache.has(cacheKey)) return animeReaderCache.get(cacheKey);

  const data = await resolveAnimeReaderText({ id, title, textUrl });
  const payload = normalizeItem({
    id: id || `reader-${Date.now()}`,
    title: data.title,
    description: `In-app reader content loaded (${data.pages.length} pages).`,
    url: data.sourceUrl,
    image: data.coverImage,
    source: data.source,
    tags: ['anime', 'novel', 'reader', 'full-story'],
    content: {
      pages: data.pages,
      totalPages: data.pages.length
    }
  });

  animeReaderCache.set(cacheKey, payload);
  return payload;
}

export async function getAnimeBooks(query = 'one piece', limit = 18) {
  const q = safeText(query) || 'one piece';
  const safeLimit = Math.max(6, Math.min(25, Number(limit) || 18));
  const remoteLimit = Math.max(4, safeLimit - Math.min(5, Math.floor(safeLimit / 3)));
  const data = await fetchJson(
    `https://api.jikan.moe/v4/manga?q=${encodeURIComponent(q)}&limit=${remoteLimit}&sfw=true&order_by=score&sort=desc`
  );
  const list = asList(data?.data).slice(0, remoteLimit);

  const normalized = list.map((item) => {
    const synopsis = safeText(item.synopsis);
    const background = safeText(item.background);
    return normalizeItem({
      id: `jikan-${item.mal_id}`,
      title: item.title,
      description: [item.type, item.status, synopsis.slice(0, 180)].filter(Boolean).join(' | '),
      url: item.url,
      image: item.images?.jpg?.image_url || '',
      source: 'jikan',
      tags: ['anime', 'manga', 'catalog'],
      content: {
        readerType: 'on-demand',
        pageEstimate: Math.max(35, Math.min(260, Math.floor((safeText(synopsis).length + safeText(background).length) / 35) || 60)),
        stats: {
          chapters: item.chapters || null,
          volumes: item.volumes || null,
          score: item.score || null
        }
      }
    });
  });

  const freeEntries = FREE_ANIME_NOVEL_LIBRARY.map((item) =>
    normalizeItem({
      ...item,
      description: `${item.description} | Read fully inside app.`,
      tags: [...item.tags, 'library']
    })
  );

  const headCount = Math.max(1, safeLimit - freeEntries.length);
  const merged = normalized.slice(0, headCount).concat(freeEntries).slice(0, safeLimit);
  setDiag('anime', { lastProvider: 'jikan+gutenberg', lastStatus: 'ok', lastError: '', lastCount: merged.length });
  return merged;
}

function decodeXmlEntities(input) {
  return safeText(input)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function getXmlTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = block.match(re);
  return decodeXmlEntities(match?.[1] || '');
}

function parseRssItems(xmlText) {
  const xml = xmlText || '';
  const matches = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/gi));
  return matches.map((m) => m[1]);
}

function parseArxivEntries(xmlText) {
  const xml = xmlText || '';
  const matches = Array.from(xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi));
  return matches.map((m) => m[1]);
}

function toIsoDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

function normalizeUsDate(dateStr = '') {
  const raw = safeText(dateStr);
  if (!raw) {
    const now = new Date();
    return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return normalizeUsDate('');
  return `${parsed.getUTCFullYear()}${String(parsed.getUTCMonth() + 1).padStart(2, '0')}${String(parsed.getUTCDate()).padStart(2, '0')}`;
}

export async function getCalendarEvents(from, to) {
  const now = new Date();
  const fromDate = from ? new Date(from) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const toDate = to ? new Date(to) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const validFrom = Number.isNaN(fromDate.getTime()) ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) : fromDate;
  const validTo = Number.isNaN(toDate.getTime()) ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)) : toDate;
  const years = new Set([validFrom.getUTCFullYear(), validTo.getUTCFullYear()]);
  const holidays = [];

  try {
    for (const year of years) {
      const list = await fetchJson(`https://date.nager.at/api/v3/PublicHolidays/${year}/US`);
      holidays.push(...asList(list));
    }
  } catch (error) {
    setDiag('calendar', { lastProvider: 'nager-date', lastStatus: 'degraded', lastError: error.message || 'calendar provider failed', lastCount: 0 });
    const fallback = [
      normalizeItem({
        id: `spk-event-${validFrom.toISOString().slice(0, 10)}`,
        title: 'SparkyPal Focus Session',
        description: 'Fallback local calendar event while live provider is unavailable.',
        source: 'calendar-local-fallback',
        tags: ['calendar', 'fallback'],
        content: { date: validFrom.toISOString().slice(0, 10), type: 'focus' }
      })
    ];
    return fallback;
  }

  const inRange = holidays.filter((h) => {
    const d = new Date(h.date);
    return d >= validFrom && d <= validTo;
  });

  const normalized = inRange.map((h) =>
    normalizeItem({
      id: `holiday-${h.date}-${safeText(h.localName)}`,
      title: h.localName || h.name || 'Holiday',
      description: `${h.name || h.localName || 'Holiday'} | ${h.countryCode || 'US'}`,
      url: 'https://date.nager.at/',
      source: 'nager-date',
      tags: ['calendar', h.global ? 'national' : 'regional'],
      content: { date: h.date, fixed: Boolean(h.fixed), counties: h.counties || [] }
    })
  );
  setDiag('calendar', { lastProvider: 'nager-date', lastStatus: 'ok', lastError: '', lastCount: normalized.length });
  return normalized;
}

function normalizeSportPath(sport = 'football', league = 'nfl') {
  const s = safeText(sport).toLowerCase();
  const l = safeText(league).toLowerCase();
  const known = {
    football: ['nfl', 'college-football'],
    basketball: ['nba', 'wnba', 'mens-college-basketball'],
    baseball: ['mlb'],
    hockey: ['nhl'],
    soccer: ['eng.1', 'usa.1', 'ind.1'],
    cricket: ['ipl', 'icc-cwc']
  };
  if (known[s]?.includes(l)) return { sport: s, league: l };
  return { sport: 'basketball', league: 'nba' };
}

export async function getSportsSuredbits({ sport = 'football', league = 'nfl', date = '', fallback = true } = {}) {
  const normalizeDateIso = (iso) => normalizeUsDate(iso).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  const dateObj = date ? new Date(date) : new Date();
  const baseDate = Number.isNaN(dateObj.getTime()) ? new Date() : dateObj;
  const normalized = normalizeSportPath(sport, league);
  const normalizeEvent = (evt, activeSport, activeLeague, reason = '') => {
    const comp = asList(evt.competitions)[0] || {};
    const teams = asList(comp.competitors);
    const away = teams.find((t) => t.homeAway === 'away');
    const home = teams.find((t) => t.homeAway === 'home');
    const status = comp?.status?.type?.shortDetail || evt?.status?.type?.shortDetail || 'Scheduled';
    const title = `${away?.team?.displayName || 'Away'} vs ${home?.team?.displayName || 'Home'}`;
    const desc = `${away?.score || 0} - ${home?.score || 0} | ${status}`;
    return normalizeItem({
      id: `espn-${evt.id || title}`,
      title,
      description: desc,
      url: safeText(evt?.links?.[0]?.href || evt?.link || ''),
      image: safeText(home?.team?.logo || away?.team?.logo || ''),
      source: 'espn',
      tags: ['sports', activeSport, activeLeague, 'live-scores'],
      content: {
        status,
        startTime: evt.date || '',
        shortName: evt.shortName || title,
        reason,
        scores: {
          away: Number(away?.score || 0),
          home: Number(home?.score || 0)
        }
      }
    });
  };

  const loadByFilter = async (activeSport, activeLeague, targetDate, reason = '') => {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${activeSport}/${activeLeague}/scoreboard?dates=${targetDate}`;
    const data = await fetchJson(url, 15000);
    const events = asList(data?.events);
    return events.map((evt) => normalizeEvent(evt, activeSport, activeLeague, reason));
  };

  const fallbackDates = [-3, -2, -1, 0, 1, 2, 3].map((delta) => {
    const d = new Date(baseDate);
    d.setDate(baseDate.getDate() + delta);
    return normalizeUsDate(d.toISOString().slice(0, 10));
  });

  const fallbackPresets = [
    { sport: 'basketball', league: 'nba', label: 'fallback:nba' },
    { sport: 'football', league: 'nfl', label: 'fallback:nfl' },
    { sport: 'baseball', league: 'mlb', label: 'fallback:mlb' },
    { sport: 'hockey', league: 'nhl', label: 'fallback:nhl' },
    { sport: 'cricket', league: 'ipl', label: 'fallback:ipl' },
    { sport: 'soccer', league: 'ind.1', label: 'fallback:india-soccer' }
  ];

  try {
    const primaryDate = normalizeUsDate(date || baseDate.toISOString().slice(0, 10));
    let items = await loadByFilter(normalized.sport, normalized.league, primaryDate, 'primary');
    if (items.length) {
      setDiag('sports', { lastProvider: 'espn', lastStatus: 'ok', lastError: '', lastCount: items.length });
      return { items, reason: '', activeFilter: { sport: normalized.sport, league: normalized.league, date: normalizeDateIso(primaryDate) } };
    }

    if (fallback) {
      for (const targetDate of fallbackDates) {
        items = await loadByFilter(normalized.sport, normalized.league, targetDate, 'fallback:date-window');
        if (items.length) {
          setDiag('sports', { lastProvider: 'espn', lastStatus: 'ok', lastError: '', lastCount: items.length });
          return { items, reason: 'No games scheduled for requested day, showing nearby schedule.', activeFilter: { sport: normalized.sport, league: normalized.league, date: normalizeDateIso(targetDate) } };
        }
      }

      for (const preset of fallbackPresets) {
        for (const targetDate of fallbackDates) {
          items = await loadByFilter(preset.sport, preset.league, targetDate, preset.label);
          if (items.length) {
            setDiag('sports', { lastProvider: 'espn', lastStatus: 'ok', lastError: '', lastCount: items.length });
            return {
              items,
              reason: `No games found for ${normalized.sport}/${normalized.league}. Showing active ${preset.sport}/${preset.league} feed.`,
              activeFilter: { sport: preset.sport, league: preset.league, date: normalizeDateIso(targetDate) }
            };
          }
        }
      }
    }

    setDiag('sports', { lastProvider: 'espn', lastStatus: 'degraded', lastError: 'No scheduled games in fallback window', lastCount: 0 });
    return {
      items: [],
      reason: 'No games scheduled in current fallback window.',
      activeFilter: { sport: normalized.sport, league: normalized.league, date: normalizeDateIso(normalizeUsDate(date || baseDate.toISOString().slice(0, 10))) }
    };
  } catch (error) {
    setDiag('sports', { lastProvider: 'espn', lastStatus: 'degraded', lastError: error.message || 'sports provider failed', lastCount: 0 });
    return {
      items: [],
      reason: 'Sports API unavailable. Retry shortly.',
      activeFilter: { sport: normalized.sport, league: normalized.league, date: normalizeDateIso(normalizeUsDate(date || baseDate.toISOString().slice(0, 10))) }
    };
  }
}

export async function searchArxiv(query, start = 0, limit = 20) {
  const q = safeText(query);
  if (!q) return [];
  const safeStart = Math.max(0, Number(start) || 0);
  const safeLimit = Math.max(1, Math.min(25, Number(limit) || 20));
  const url =
    `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}` +
    `&start=${safeStart}&max_results=${safeLimit}&sortBy=relevance&sortOrder=descending`;
  try {
    const xml = await fetchText(url, 18000);
    const entries = parseArxivEntries(xml);
    const items = entries.map((entry, idx) => {
      const links = Array.from(entry.matchAll(/<link([^>]+)>/gi)).map((m) => m[1] || '');
      const pdfLink = links
        .map((chunk) => chunk.match(/href="([^"]+)"/i)?.[1] || '')
        .find((href) => href.includes('/pdf/'));
      const pageLink = getXmlTag(entry, 'id');
      const authors = Array.from(entry.matchAll(/<name>([\s\S]*?)<\/name>/gi))
        .map((m) => decodeXmlEntities(m[1] || ''))
        .filter(Boolean)
        .slice(0, 4)
        .join(', ');
      return normalizeItem({
        id: `arxiv-${safeText(pageLink).split('/').pop() || `${safeStart + idx}`}`,
        title: getXmlTag(entry, 'title') || `arXiv Result ${idx + 1}`,
        description: [authors, getXmlTag(entry, 'summary').replace(/\s+/g, ' ').slice(0, 260)].filter(Boolean).join(' | '),
        url: pageLink,
        mediaUrl: pdfLink || '',
        source: 'arxiv',
        tags: ['research', 'arxiv'],
        content: {
          updatedAt: toIsoDate(getXmlTag(entry, 'updated')),
          publishedAt: toIsoDate(getXmlTag(entry, 'published'))
        }
      });
    });
    setDiag('arxiv', { lastProvider: 'arxiv', lastStatus: 'ok', lastError: '', lastCount: items.length });
    return items;
  } catch (error) {
    setDiag('arxiv', { lastProvider: 'arxiv', lastStatus: 'degraded', lastError: error.message || 'arxiv failed', lastCount: 0 });
    return [];
  }
}

export async function mapSearch(query, limit = 10) {
  const q = safeText(query);
  if (!q) return [];
  const safeLimit = Math.max(1, Math.min(20, Number(limit) || 10));
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=${safeLimit}&q=${encodeURIComponent(q)}`;
  try {
    const data = await fetchJson(url, 15000);
    const items = asList(data).map((row) =>
      normalizeItem({
        id: `map-${row.place_id}`,
        title: safeText(row.display_name).split(',').slice(0, 2).join(', ') || 'Location',
        description: safeText(row.display_name),
        url: `https://www.openstreetmap.org/?mlat=${row.lat}&mlon=${row.lon}#map=13/${row.lat}/${row.lon}`,
        source: 'nominatim',
        tags: ['map', safeText(row.type || 'place')],
        content: {
          lat: Number(row.lat),
          lon: Number(row.lon),
          type: safeText(row.type),
          importance: Number(row.importance || 0)
        }
      })
    );
    setDiag('map', { lastProvider: 'nominatim', lastStatus: 'ok', lastError: '', lastCount: items.length });
    return items;
  } catch (error) {
    setDiag('map', { lastProvider: 'nominatim', lastStatus: 'degraded', lastError: error.message || 'map search failed', lastCount: 0 });
    return [];
  }
}

export async function mapReverse(lat, lon) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`;
  try {
    const row = await fetchJson(url, 15000);
    const item = normalizeItem({
      id: `map-reverse-${latitude}-${longitude}`,
      title: safeText(row.name) || safeText(row.display_name).split(',').slice(0, 2).join(', '),
      description: safeText(row.display_name),
      url: `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=13/${latitude}/${longitude}`,
      source: 'nominatim',
      tags: ['map', 'reverse-geocode'],
      content: { lat: latitude, lon: longitude, address: row.address || {} }
    });
    setDiag('map', { lastProvider: 'nominatim', lastStatus: 'ok', lastError: '', lastCount: 1 });
    return item;
  } catch (error) {
    setDiag('map', { lastProvider: 'nominatim', lastStatus: 'degraded', lastError: error.message || 'reverse geocode failed', lastCount: 0 });
    return null;
  }
}

function normalizeNewsRegion(region = 'US') {
  const upper = safeText(region).toUpperCase();
  if (upper === 'IN') return { gl: 'IN', ceid: 'IN:en', hl: 'en-IN' };
  if (upper === 'GB') return { gl: 'GB', ceid: 'GB:en', hl: 'en-GB' };
  return { gl: 'US', ceid: 'US:en', hl: 'en-US' };
}

export async function getLiveNews({ category = 'top', region = 'US', limit = 20 } = {}) {
  const safeLimit = Math.max(5, Math.min(40, Number(limit) || 20));
  const query = safeText(category) && safeText(category) !== 'top' ? safeText(category) : 'latest world news';
  const locale = normalizeNewsRegion(region);
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${locale.hl}&gl=${locale.gl}&ceid=${locale.ceid}`;
  try {
    const xml = await fetchText(url, 15000);
    const items = parseRssItems(xml)
      .slice(0, safeLimit)
      .map((item, idx) =>
        normalizeItem({
          id: `news-${idx}-${safeText(getXmlTag(item, 'guid') || getXmlTag(item, 'link'))}`,
          title: getXmlTag(item, 'title'),
          description: getXmlTag(item, 'description').replace(/<[^>]+>/g, '').slice(0, 280),
          url: getXmlTag(item, 'link'),
          source: 'google-news-rss',
          tags: ['news', safeText(category || 'top').toLowerCase(), locale.gl.toLowerCase()],
          content: {
            pubDate: toIsoDate(getXmlTag(item, 'pubDate')),
            source: getXmlTag(item, 'source')
          }
        })
      );
    setDiag('news', { lastProvider: 'google-news-rss', lastStatus: 'ok', lastError: '', lastCount: items.length });
    return items;
  } catch (error) {
    setDiag('news', { lastProvider: 'google-news-rss', lastStatus: 'degraded', lastError: error.message || 'news provider failed', lastCount: 0 });
    return [];
  }
}

function htmlToReadableText(html = '') {
  const blocks = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|h1|h2|h3|li|article|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{2,}/g, '\n\n')
    .trim();
  return decodeXmlEntities(blocks);
}

async function fetchJinaReadable(url = '') {
  const validated = validateExternalReaderUrl(url);
  if (!validated.ok) return '';
  try {
    const stripped = validated.url.replace(/^https?:\/\//i, '');
    const proxied = await fetchText(`https://r.jina.ai/http://${stripped}`, 18000);
    return safeText(proxied).replace(/\n{3,}/g, '\n\n').trim();
  } catch {
    return '';
  }
}

export async function getNewsReadContent({ id = '', title = '', url = '', description = '' } = {}) {
  const safeTitle = safeText(title) || 'News Reader';
  const rawUrl = safeText(url);
  const urlValidation = rawUrl ? validateExternalReaderUrl(rawUrl) : { ok: false, reason: '', url: '' };
  const safeUrl = urlValidation.ok ? urlValidation.url : '';
  const baseDescription = safeText(description).replace(/&nbsp;?/gi, ' ').replace(/\s+/g, ' ').trim();
  const blockedUrlReason = rawUrl && !urlValidation.ok ? urlValidation.reason : '';
  let readable = baseDescription;
  try {
    if (safeUrl) {
      const html = await fetchText(safeUrl, 15000);
      const extracted = htmlToReadableText(html).slice(0, 24000);
      if (extracted.length > 800) readable = extracted;
    }
  } catch {
    // Preserve fallback from feed description.
  }

  if (readable.length < 800 && safeUrl) {
    const jina = await fetchJinaReadable(safeUrl);
    if (jina.length > readable.length) readable = jina.slice(0, 26000);
  }

  if (!readable || readable.length < 420) {
    const expanded = [
      `Headline: ${safeTitle}`,
      `Summary: ${baseDescription || 'Live update received from the wire feed.'}`,
      'Overview: This in-app briefing expands the available wire summary into a readable article format so users can continue reading inside SparkyPal without a forced redirect.',
      `Context: ${baseDescription || 'Upstream publishers can restrict full-text access or rely on script-rendered pages. SparkyPal keeps a resilient fallback narrative for uninterrupted in-app reading.'}`,
      blockedUrlReason ? `Blocked URL notice: ${blockedUrlReason}.` : '',
      'What to watch next: Monitor official statements, follow-up reports, and verified data points as this story evolves.',
      safeUrl ? `Source URL retained for verification: ${safeUrl}` : ''
    ].filter(Boolean).join('\n\n');
    readable = expanded;
  }

  const cleanReadable = readable
    .replace(/&nbsp;?/gi, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return normalizeItem({
    id: id || `news-read-${Date.now()}`,
    title: safeTitle,
    description: `In-app reader loaded (${safeUrl ? 'source-backed' : 'feed-backed'})`,
    url: safeUrl,
    source: 'news-reader',
    tags: ['news', 'reader', 'in-app'],
    content: {
      pages: splitParagraphPages(cleanReadable, 1200, 320),
      sourceUrl: safeUrl
    }
  });
}

export async function getArxivReadContent({ id = '', title = '', url = '', description = '' } = {}) {
  const articleId = safeText(id).replace(/^arxiv-/, '').replace(/v\d+$/, '');
  const fallbackTitle = safeText(title) || 'arXiv Reader';
  const fallbackDescription = safeText(description);
  let blockText = '';
  let pageUrl = safeText(url);
  let paperTitle = fallbackTitle;
  let blockedUrlReason = '';
  try {
    if (articleId) {
      const feed = await fetchText(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(articleId)}`, 16000);
      const entry = parseArxivEntries(feed)[0] || '';
      const summary = getXmlTag(entry, 'summary').replace(/\s+/g, ' ');
      const authors = Array.from(entry.matchAll(/<name>([\s\S]*?)<\/name>/gi))
        .map((m) => decodeXmlEntities(m[1] || ''))
        .filter(Boolean)
        .join(', ');
      pageUrl = getXmlTag(entry, 'id') || pageUrl;
      paperTitle = getXmlTag(entry, 'title') || fallbackTitle;
      blockText = [
        `Title: ${paperTitle}`,
        authors ? `Authors: ${authors}` : '',
        summary ? `Abstract:\n${summary}` : ''
      ].filter(Boolean).join('\n\n');
    }
  } catch {
    // keep fallback path below
  }

  if (!blockText && fallbackDescription) {
    blockText = [
      `Title: ${paperTitle}`,
      `Summary:\n${fallbackDescription}`
    ].join('\n\n');
  }

  const pageUrlValidation = pageUrl ? validateExternalReaderUrl(pageUrl) : { ok: false, reason: '', url: '' };
  const safePageUrl = pageUrlValidation.ok ? pageUrlValidation.url : '';
  if (pageUrl && !pageUrlValidation.ok) {
    blockedUrlReason = pageUrlValidation.reason;
  }

  if (blockText.length < 600 && safePageUrl) {
    const jina = await fetchJinaReadable(safePageUrl);
    if (jina.length > blockText.length) {
      blockText = [
        `Title: ${paperTitle}`,
        jina.slice(0, 22000)
      ].join('\n\n');
    }
  }

  if (!blockText) {
    blockText = `${paperTitle}\n\nAbstract unavailable from upstream at the moment. SparkyPal keeps the built-in reader active with available metadata.`;
  }
  if (blockedUrlReason) {
    blockText = `${blockText}\n\nBlocked URL notice: ${blockedUrlReason}.`;
  }
  return normalizeItem({
    id: id || `arxiv-read-${Date.now()}`,
    title: paperTitle,
    description: 'In-app research reader loaded.',
    url: safePageUrl,
    source: 'research-reader',
    tags: ['research', 'reader', 'in-app'],
    content: {
      pages: splitParagraphPages(blockText, 1200, 320)
    }
  });
}

export function getEpicChapters(epic = 'mahabharat', language = 'eng') {
  const lang = epicLocale(language);
  const source = epic === 'ramayan' ? RAMAYAN_KANDAS : MAHABHARAT_PARVAS;
  const titlePrefix = epic === 'ramayan'
    ? (lang === 'hin' ? 'रामायण' : 'Ramayan')
    : (lang === 'hin' ? 'महाभारत' : 'Mahabharat');
  const items = source.map((chapter, idx) =>
    normalizeItem({
      id: `${epic}-${idx + 1}`,
      title: `${idx + 1}. ${chapter}`,
      description: lang === 'hin'
        ? `${titlePrefix} का अध्याय ${idx + 1} — पूर्ण-पाठ पाठन मोड`
        : `${titlePrefix} chapter ${idx + 1} — full-text in-app reading mode`,
      source: 'epic-local-pack',
      tags: ['epic', epic, lang, 'full-text'],
      content: { chapterNo: idx + 1, language: lang }
    })
  );
  setDiag('epics', { lastProvider: 'epic-local-pack', lastStatus: 'ok', lastError: '', lastCount: items.length });
  return items;
}

export async function getEpicReadContent(epic = 'mahabharat', chapterId = '1', language = 'eng') {
  const lang = epicLocale(language);
  const chapterNo = Math.max(1, Number(String(chapterId).replace(/[^\d]/g, '')) || 1);
  const source = epic === 'ramayan' ? RAMAYAN_KANDAS : MAHABHARAT_PARVAS;
  const idx = Math.min(source.length - 1, chapterNo - 1);
  const chapterTitle = source[idx];
  const epicTitle = epic === 'ramayan'
    ? (lang === 'hin' ? 'रामायण' : 'Ramayan')
    : (lang === 'hin' ? 'महाभारत' : 'Mahabharat');
  const sourceText = await getEpicSourceText(epic);
  const chapterSlice = sliceEpicChapterText(sourceText, chapterTitle, idx, source.length);
  const fallbackText = buildEpicNarrative(epicTitle, chapterTitle, idx, lang);
  const englishCore = chapterSlice || fallbackText;
  const text = lang === 'hin'
    ? `हिंदी पाठन मोड सक्रिय। मूल सार्वजनिक-डोमेन अंग्रेज़ी पाठ नीचे उपलब्ध है।\n\n${englishCore}`
    : englishCore;

  return normalizeItem({
    id: `${epic}-read-${chapterNo}`,
    title: `${epicTitle}: ${chapterTitle}`,
    description: lang === 'hin' ? 'पूर्ण-पाठ पाठन मोड सक्रिय' : 'Full-text reading mode active',
    source: 'epic-local-pack',
    tags: ['epic', epic, lang, 'reader'],
    content: {
      chapterNo,
      language: lang,
      pages: splitParagraphPages(text, 1100, 260)
    }
  });
}

function normalizeStockSymbol(symbol = 'AAPL') {
  return safeText(symbol).toUpperCase().replace(/[^A-Z0-9.\-]/g, '') || 'AAPL';
}

function parseStooqCsv(csvText) {
  const lines = (csvText || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const firstCols = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const hasHeader = firstCols.includes('symbol') || firstCols.includes('<ticker>');
  const header = hasHeader
    ? firstCols
    : ['symbol', 'date', 'time', 'open', 'high', 'low', 'close', 'volume'];
  const body = hasHeader ? lines.slice(1) : lines;
  return body.map((line) => {
    const cols = line.split(',');
    const row = {};
    header.forEach((key, idx) => {
      row[key] = cols[idx];
    });
    return row;
  });
}

async function fetchStooqQuote(symbol) {
  const ticker = normalizeStockSymbol(symbol).toLowerCase();
  const csv = await fetchText(`https://stooq.com/q/l/?s=${encodeURIComponent(ticker)}.us&i=d`, 12000);
  const row = parseStooqCsv(csv)[0];
  if (!row || !row.close || row.close === 'N/D') return null;
  const price = Number(row.close);
  const open = Number(row.open || price);
  const change = Number.isFinite(price) && Number.isFinite(open) ? price - open : 0;
  const changePercent = open ? (change / open) * 100 : 0;
  return {
    symbol: normalizeStockSymbol(symbol),
    shortName: normalizeStockSymbol(symbol),
    regularMarketPrice: price,
    regularMarketChange: change,
    regularMarketChangePercent: changePercent,
    regularMarketTime: Date.now() / 1000
  };
}

async function fetchStooqChart(symbol, range = '1d') {
  const ticker = normalizeStockSymbol(symbol).toLowerCase();
  const interval = range === '1d' ? '5' : range === '5d' ? '30' : 'd';
  const endpoint = interval === 'd'
    ? `https://stooq.com/q/d/l/?s=${encodeURIComponent(ticker)}.us&i=d`
    : `https://stooq.com/q/i/?s=${encodeURIComponent(ticker)}.us&i=${interval}`;
  const csv = await fetchText(endpoint, 12000);
  const rows = parseStooqCsv(csv).slice(-180);
  return rows.map((row, idx) => {
    const rawTime = row.date && row.time ? `${row.date}T${row.time}Z` : `${row.date || ''}T00:00:00Z`;
    const ts = Date.parse(rawTime);
    const price = Number(row.close || row.last || row.open || 0);
    return { t: Number.isFinite(ts) ? Math.floor(ts / 1000) : idx, p: price };
  }).filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p) && point.p > 0);
}

function normalizeStockRow(row, ticker) {
  const symbol = normalizeStockSymbol(row.symbol || ticker);
  return normalizeItem({
    id: `stock-${symbol}`,
    title: `${symbol} | ${safeText(row.shortName || row.longName || symbol)}`,
    description: `Price ${row.regularMarketPrice ?? '-'} | Change ${row.regularMarketChange ?? 0} (${row.regularMarketChangePercent ?? 0}%)`,
    url: `https://finance.yahoo.com/quote/${symbol}`,
    source: 'yahoo-finance',
    tags: ['stocks', symbol],
    content: {
      symbol,
      price: Number(row.regularMarketPrice || 0),
      change: Number(row.regularMarketChange || 0),
      changePercent: Number(row.regularMarketChangePercent || 0),
      marketTime: Number(row.regularMarketTime || 0)
    }
  });
}

export async function getStockQuote(symbol = 'AAPL') {
  const ticker = normalizeStockSymbol(symbol);
  try {
    const data = await fetchJson(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}`, 12000);
    const row = asList(data?.quoteResponse?.result)[0];
    if (!row) throw new Error('empty quote payload');
    const item = normalizeStockRow(row, ticker);
    setDiag('stocks', { lastProvider: 'yahoo-finance', lastStatus: 'ok', lastError: '', lastCount: 1 });
    return item;
  } catch (error) {
    try {
      const stooq = await fetchStooqQuote(ticker);
      if (!stooq) throw new Error('stooq quote unavailable');
      const item = normalizeStockRow(stooq, ticker);
      item.source = 'stooq';
      setDiag('stocks', { lastProvider: 'stooq', lastStatus: 'ok', lastError: '', lastCount: 1 });
      return item;
    } catch (fallbackErr) {
      setDiag('stocks', { lastProvider: 'yahoo-finance', lastStatus: 'degraded', lastError: fallbackErr.message || error.message || 'stocks quote failed', lastCount: 0 });
      return null;
    }
  }
}

export async function getStockWatchlist(symbols = []) {
  const cleanSymbols = asList(symbols)
    .map((s) => normalizeStockSymbol(s))
    .filter(Boolean)
    .slice(0, 25);
  const used = cleanSymbols.length ? cleanSymbols : ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'NVDA'];
  try {
    const data = await fetchJson(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(used.join(','))}`, 12000);
    const rows = asList(data?.quoteResponse?.result);
    if (!rows.length) throw new Error('empty watchlist payload');
    const items = rows.map((row) => normalizeStockRow(row, row.symbol));
    setDiag('stocks', { lastProvider: 'yahoo-finance', lastStatus: 'ok', lastError: '', lastCount: items.length });
    return items;
  } catch (error) {
    const fallbackItems = [];
    for (const symbol of used.slice(0, 10)) {
      try {
        const row = await fetchStooqQuote(symbol);
        if (!row) continue;
        const item = normalizeStockRow(row, symbol);
        item.source = 'stooq';
        fallbackItems.push(item);
      } catch {
        // keep trying remaining symbols
      }
    }
    if (fallbackItems.length) {
      setDiag('stocks', { lastProvider: 'stooq', lastStatus: 'ok', lastError: '', lastCount: fallbackItems.length });
      return fallbackItems;
    }
    setDiag('stocks', { lastProvider: 'yahoo-finance', lastStatus: 'degraded', lastError: error.message || 'stocks watchlist failed', lastCount: 0 });
    return [];
  }
}

export async function getStockChart(symbol = 'AAPL', range = '1d') {
  const ticker = normalizeStockSymbol(symbol);
  const safeRange = ['1d', '5d', '1mo'].includes(range) ? range : '1d';
  const interval = safeRange === '1d' ? '5m' : safeRange === '5d' ? '30m' : '1d';
  try {
    const data = await fetchJson(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${safeRange}&interval=${interval}`,
      12000
    );
    const result = asList(data?.chart?.result)[0];
    const timestamps = asList(result?.timestamp);
    const prices = asList(result?.indicators?.quote?.[0]?.close);
    const points = timestamps
      .map((ts, idx) => ({ t: Number(ts), p: Number(prices[idx]) }))
      .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p));
    setDiag('stocks', { lastProvider: 'yahoo-finance', lastStatus: 'ok', lastError: '', lastCount: points.length });
    return {
      symbol: ticker,
      range: safeRange,
      interval,
      points
    };
  } catch (error) {
    try {
      const points = await fetchStooqChart(ticker, safeRange);
      setDiag('stocks', { lastProvider: 'stooq', lastStatus: 'ok', lastError: '', lastCount: points.length });
      return { symbol: ticker, range: safeRange, interval, points };
    } catch (fallbackErr) {
      setDiag('stocks', { lastProvider: 'yahoo-finance', lastStatus: 'degraded', lastError: fallbackErr.message || error.message || 'stocks chart failed', lastCount: 0 });
      return { symbol: ticker, range: safeRange, interval, points: [] };
    }
  }
}
