// The project's pages outside the game. A link with an empty address is not shown.
export const DOCS_URL = 'https://doc.mihaomeme.garden/';
export const X_URL = ''; // the project's X profile, like https://x.com/name

export function siteLinks() {
  const links = [['docsLink', DOCS_URL], ['xLink', X_URL]];
  for (const [id, url] of links) {
    const a = document.getElementById(id);
    if (!a || !url) continue;
    a.href = url;
    a.hidden = false;
  }
}

// Menu entries: [icon, label, open]
export const linkMenuItems = () => [['album', 'Docs', DOCS_URL], ['chat', 'Follow on X', X_URL]]
  .filter(([, , url]) => url)
  .map(([icon, label, url]) => [icon, label, () => window.open(url, '_blank', 'noopener')]);
