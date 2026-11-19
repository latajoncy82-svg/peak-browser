const BLOCKED_HOSTS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adservice.google.com',
  'google-analytics.com',
  'googletagmanager.com',
  'pagead2.googlesyndication.com',
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
  'zedo.com',
  'revcontent.com',
  'mgid.com',
  'popads.net',
  'propellerads.com',
  'gemius.pl',
  'hit.gemius.pl'
];

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const SAFE_PROTOCOLS = new Set(['peak:', 'file:', 'data:', 'blob:', 'about:', 'devtools:']);

function isBlockedHost(hostname) {
  if (!hostname) return false;
  const host = hostname.toLowerCase();
  if (LOCAL_HOSTS.has(host)) return false;

  for (const blocked of BLOCKED_HOSTS) {
    if (host === blocked || host.endsWith(`.${blocked}`)) {
      return true;
    }
  }
  return false;
}

function shouldBlockRequest(rawUrl, resourceType) {
  if (!rawUrl || resourceType === 'mainFrame') {
    return false;
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (SAFE_PROTOCOLS.has(parsed.protocol)) {
    return false;
  }

  return isBlockedHost(parsed.hostname);
}

module.exports = {
  BLOCKED_HOSTS,
  shouldBlockRequest
};
