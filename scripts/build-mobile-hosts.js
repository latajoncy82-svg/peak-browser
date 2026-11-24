const fs = require('fs');
const path = require('path');

const FILTER_URLS = [
  'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext',
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt',
  'https://raw.githubusercontent.com/MajkiIT/polish-ads-filter/master/polish-adblock-filters/adblock.txt'
];

const CORE_HOSTS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adservice.google.com',
  'pagead2.googlesyndication.com',
  'google-analytics.com',
  'googletagmanager.com',
  'analytics.google.com',
  'taboola.com',
  'outbrain.com',
  'criteo.com',
  'criteo.net',
  'amazon-adsystem.com',
  'adnxs.com',
  'rubiconproject.com',
  'pubmatic.com',
  'openx.net',
  'casalemedia.com',
  'scorecardresearch.com',
  'quantserve.com',
  'hotjar.com',
  'mouseflow.com',
  'fullstory.com',
  'mixpanel.com',
  'segment.io',
  'adroll.com',
  'adsrvr.org',
  'moatads.com',
  'serving-sys.com',
  'revcontent.com',
  'mgid.com',
  'popads.net',
  'propellerads.com',
  'gemius.pl',
  'hit.gemius.pl',
  'adocean.pl',
  'smartadserver.com',
  'adform.net',
  'yieldlove-ad-serving.net',
  'connect.facebook.net',
  'ads.youtube.com',
  'an.yandex.ru',
  'mc.yandex.ru'
];

const HOST_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

function extractHostsFromFilterText(text, targetSet) {
  const lines = String(text || '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('!') || line.startsWith('[') || line.startsWith('@@')) continue;
    if (line.includes('##') || line.includes('#@#') || line.includes('#?#')) continue;

    // Adblock domain rule: ||example.com^ or ||example.com^$third-party
    if (line.startsWith('||')) {
      const rest = line.slice(2);
      const caretIdx = rest.indexOf('^');
      if (caretIdx <= 0) continue;
      const hostPart = rest.slice(0, caretIdx).toLowerCase();
      const tail = rest.slice(caretIdx + 1);
      if (tail && !tail.startsWith('$')) continue;
      if (tail.includes('domain=') || tail.includes('important') === false && tail.includes('badfilter')) {
        if (tail.includes('badfilter')) continue;
      }
      if (HOST_REGEX.test(hostPart)) {
        targetSet.add(hostPart);
      }
      continue;
    }

    // Hosts-file format: 0.0.0.0 example.com or 127.0.0.1 example.com
    const hostsMatch = /^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([a-z0-9.-]+)/i.exec(line);
    if (hostsMatch) {
      const candidate = hostsMatch[1].toLowerCase();
      if (candidate !== 'localhost' && HOST_REGEX.test(candidate)) {
        targetSet.add(candidate);
      }
    }
  }
}

async function main() {
  const outPath = path.resolve(__dirname, '..', 'mobile-android', 'app', 'src', 'main', 'assets', 'mobile-ad-hosts.txt');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const hosts = new Set(CORE_HOSTS);

  for (const url of FILTER_URLS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const text = await res.text();
        extractHostsFromFilterText(text, hosts);
      }
    } catch {
      // Continue with other lists + CORE_HOSTS
    }
  }

  const sorted = Array.from(hosts).sort();
  fs.writeFileSync(outPath, sorted.join('\n') + '\n', 'utf8');
  console.log(`Generated ${sorted.length} mobile block hosts -> ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
