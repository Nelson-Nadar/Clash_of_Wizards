const list = document.querySelector('#list');

function connect() {
    const w = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
    w.onopen = () => w.send(JSON.stringify({ type: 'hello', role: 'leaderboard' }));
    w.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.type !== 'state') return;
        const top = m.leaderboard.slice(0, 10);
        if (!top.length) {
            list.innerHTML = '<p class="status empty-state">The first score is waiting to be made.</p>';
            return;
        }
        const podiumAssets = [
            '/leaderboard/elder_wand.jpg',
            '/leaderboard/resurrection_stone.jpg',
            '/leaderboard/invisibility_cloak.jpg'
        ];
        const podium = top.slice(0, 3).map((r, i) => {
            const rank = i + 1;
            return `<section class="podium-entry rank-${rank}">
                <div class="rank-label">#${rank} WIZARD</div>
                <img class="object-image" src="${podiumAssets[i]}" alt="${['Elder Wand', 'Resurrection Stone', 'Invisibility Cloak'][i]}" />
                <div class="player-card">
                    <div class="player-name">${esc(r.name)}</div>
                    <div class="player-score">${Number(r.score).toLocaleString()}</div>
                </div>
            </section>`;
        }).join('');
        const rest = top.slice(3).map((r, i) => `<div class="row">
            <span class="rank">${String(i + 4).padStart(2, '0')}</span>
            <span class="player-name">${esc(r.name)}</span>
            <span class="points">${Number(r.score).toLocaleString()}</span>
        </div>`).join('');
        list.innerHTML = `${top.length ? `<div class="top-three">${podium}</div>` : ''}${rest ? `<div class="rest-list">${rest}</div>` : ''}`;
    };
    w.onclose = () => setTimeout(connect, 1000);
}

function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
connect();
