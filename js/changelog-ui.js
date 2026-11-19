export function renderChangelogEntries(container, changelog, { showCurrentBadge = true } = {}) {
  container.replaceChildren();
  changelog.releases.forEach((release) => {
    const article = document.createElement('article');
    article.className = 'rounded-xl border border-white/10 bg-white/5 p-3';
    const heading = document.createElement('div');
    heading.className = 'flex flex-wrap items-center justify-between gap-2';
    const version = document.createElement('h3');
    version.className = 'font-display text-[10px] font-black text-amber-200';
    version.textContent = release.version;
    const date = document.createElement('time');
    date.className = 'text-[10px] text-slate-400';
    date.dateTime = release.date;
    date.textContent = release.date;
    heading.append(version, date);
    if (showCurrentBadge && release.version === changelog.currentVersion) {
      const current = document.createElement('span');
      current.className = 'rounded-full border border-emerald-400/35 bg-emerald-400/10 px-2 py-0.5 font-display text-[8px] font-bold text-emerald-200';
      current.textContent = 'CURRENT';
      heading.append(current);
    }

    const changes = document.createElement('ul');
    changes.className = 'mt-2 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-slate-300';
    release.changes.forEach((change) => {
      const item = document.createElement('li');
      item.textContent = change;
      changes.appendChild(item);
    });
    article.append(heading, changes);
    container.appendChild(article);
  });
}
