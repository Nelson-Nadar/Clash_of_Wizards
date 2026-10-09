import { CONFIG } from './config.js';
import { segmentCircle } from './collision.js';

const cv = document.querySelector('#game');
const ctx = cv.getContext('2d');
const $ = s => document.querySelector(s);

const entityImages = new Map();

[...CONFIG.ENTITIES, CONFIG.SPECIAL_ENTITY, CONFIG.PENALTY_ENTITY].forEach(entity => {
    const image = new Image();
    image.src = entity.asset;
    entityImages.set(entity.name, image);
});

let ws, state = { phase: 'idle', timeLeft: 150 }, objects = [], effects = [], blade = [], prev = null, score = 0, lives = 3, bombs = 0, last = performance.now(), clock = 0, nextSpawn = 0, lastReport = 0, firstRunningFrame = true, gameEnded = false, countdownTimer = null;

const debug = (...details) => {
    if (CONFIG.DEBUG) console.debug('[Defense of Hogwarts]', ...details);
};

function socket() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);

    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', role: 'game' }));

    ws.onmessage = e => {
        let m = JSON.parse(e.data);

        if (m.type === 'state') {
            let old = state.phase;
            state = m.state;
            $('#high').textContent = m.highScore;

            if (state.phase === 'countdown') gameEnded = false;

            screen(old);
        } else if (m.type === 'laser') {
            laser(m);
        } else if (m.type === 'endGame') {
            endGame(m.reason);
        }
    };

    ws.onclose = () => setTimeout(socket, 1000);
}

socket();

function screen(old) {
    let s = $('#splash');

    debug('GAME_STATE', old, '→', state.phase);

    if (state.phase === 'countdown' && old !== 'countdown') {
        debug('COUNTDOWN_START');

        s.classList.remove('hidden');

        let n = 3;

        let tick = () => {
            if (gameEnded || state.phase !== 'countdown') return;

            $('#title').textContent = n > 0 ? n : 'SLASH!';
            $('#subtitle').textContent = '';

            n--;

            if (n >= 0) {
                countdownTimer = setTimeout(tick, 700);
            } else {
                countdownTimer = setTimeout(() => {
                    if (!gameEnded && state.phase === 'countdown') {
                        debug('COUNTDOWN_COMPLETE');
                        ws?.send(JSON.stringify({ type: 'countdownComplete' }));
                    }
                }, 700);
            }
        };

        tick();
    } else if (state.phase === 'running') {
        debug('GAME_LOOP_ACTIVE');
        s.classList.add('hidden');
    } else if (state.phase === 'paused') {
        $('#title').textContent = 'PAUSED';
        $('#subtitle').textContent = 'Waiting for admin';
        s.classList.remove('hidden');
    } else if (state.phase === 'over') {
        $('#title').textContent = 'GAME OVER';

        const reason = state.completedResult?.gameEndReason || 'ROUND COMPLETE';

        $('#subtitle').textContent = `${score.toLocaleString()} POINTS · DOBBY HITS: ${bombs} · ${reason} · WAITING FOR ADMIN`;

        s.classList.remove('hidden');
    } else {
        $('#title').textContent = 'READY TO SLASH?';
        $('#subtitle').textContent = 'Awaiting admin start signal';

        s.classList.remove('hidden');

        objects = [];
        effects = [];
        blade = [];
        prev = null;
        score = 0;
        lives = 3;
        bombs = 0;
        gameEnded = false;
    }
}

function endGame(reason) {
    if (gameEnded) return;

    gameEnded = true;

    clearTimeout(countdownTimer);
    countdownTimer = null;

    prev = null;

    state = {
        ...state,
        phase: 'over',
        timeLeft: reason === 'TIME'
            ? 0
            : Math.max(0, Number(state.timeLeft) || 0)
    };

    const highestScore = Math.max(
        score,
        Number($('#high').textContent) || 0
    );

    ws?.send(JSON.stringify({
        type: 'gameComplete',
        score,
        highestScore,
        livesRemaining: lives,
        bombsHit: bombs,
        difficulty: state.difficulty,
        duration: state.duration,
        timeLeft: state.timeLeft,
        gameEndReason: reason
    }));

    screen('running');
}

function laser(m) {
    if (gameEnded || state.phase !== 'running') {
        prev = null;
        return;
    }

    if (!m.detected) {
        prev = null;
        return;
    }

    let p = {
        x: m.x * cv.width,
        y: m.y * cv.height
    };

    if (prev && state.phase === 'running') {
        objects.forEach(o => {
            if (!o.dead && segmentCircle(prev, p, o, o.r)) {
                hit(o);
            }
        });
    }

    prev = p;

    blade.push({
        ...p,
        at: clock
    });

    if (blade.length > 18) blade.shift();
}

function spawn() {
    let d = CONFIG.DIFFICULTY[state.difficulty] || CONFIG.DIFFICULTY.medium;

    if (objects.length >= d.max) return;

    let bomb = Math.random() < d.bomb;
    let star = !bomb && Math.random() < 0.08;
    let entity = null;
    if (!bomb && !star) {
        const roll = Math.random() * 100;
        let cumulative = 0;
        entity = CONFIG.ENTITIES.find(candidate => {
            cumulative += candidate.weight;
            return roll < cumulative;
        }) || CONFIG.ENTITIES[CONFIG.ENTITIES.length - 1];
    }
    let top = Math.random() < 0.2;

    // Final fine-tuning relative to the v3 entity sizes.
    // All regular entities except Bellatrix are reduced by 10%.
    // Bellatrix and Dobby receive their requested boosts; Golden Snitch is reduced by 10%.
    const entitySizeMultiplier = star
        ? 1.1 * 1.4 * 0.9
        : bomb
            ? 1.7
            : ({
                'death_eater.svg': 1.2 * 0.9,
                'dementors.svg': 1.5 * 0.9,
                'dragon.svg': 2.6 * 0.9,
                'troll.svg': 1.9 * 0.9,
                'werewolf.svg': 1.7 * 0.9,
                'bellatrix.svg': 1.5 * 1.5
            }[String(entity.asset).split('/').pop()] || 0.9);

    objects.push({
        x: Math.random() * cv.width,
        y: top ? -55 : cv.height + 55,

        vx: (Math.random() - 0.5) * 300 * d.speed,
        vy: top
            ? 70
            : -(650 + Math.random() * 250) * d.speed,

        // Keep hit bounds aligned with the individually scaled rendered entity.
        r: 36 * 1.6 * entitySizeMultiplier,

        type: bomb ? 'bomb' : star ? 'star' : 'entity',

        entityName: bomb ? CONFIG.PENALTY_ENTITY.name : star ? CONFIG.SPECIAL_ENTITY.name : entity.name,
        asset: bomb ? CONFIG.PENALTY_ENTITY.asset : star ? CONFIG.SPECIAL_ENTITY.asset : entity.asset,
        color: bomb ? CONFIG.PENALTY_ENTITY.color : star ? CONFIG.SPECIAL_ENTITY.color : entity.color,

        rot: Math.random() * 6,
        spin: (Math.random() - 0.5) * 5,
        dead: false
    });

    debug(
        'OBJECT_CREATED',
        objects.at(-1).type,
        objects.at(-1).entityName
    );
}

function hit(o) {
    if (gameEnded || state.phase !== 'running' || o.dead) return;

    o.dead = true;

    if (o.type === 'bomb') {
        score = Math.max(0, score + CONFIG.SCORES.bomb);
        lives--;
        bombs++;

        effects.push({
            x: o.x,
            y: o.y,
            color: '#ff7058',
            until: clock + 650,
            boom: true
        });
    } else {
        score += o.type === 'star'
            ? CONFIG.SCORES.star
            : CONFIG.SCORES.fruit;

        effects.push({
            x: o.x,
            y: o.y,
            color: o.type === 'star'
                ? '#ffe568'
                : o.color,
            until: clock + 2300,
            boom: false
        });
    }

    if (lives <= 0) endGame('LIVES_DEPLETED');
}

function report(time = state.timeLeft) {
    ws?.send(JSON.stringify({
        type: 'gameUpdate',
        score,
        lives,
        bombsHit: bombs,
        timeLeft: time
    }));
}

function draw(o) {
    ctx.save();

    ctx.translate(o.x, o.y);
    ctx.rotate(o.rot);

    const image = entityImages.get(o.entityName);

    if (image && image.complete && image.naturalWidth > 0) {
        const size = o.r * 2;
        // Preserve each asset's intrinsic aspect ratio while fitting it within the entity bounds.
        const aspect = image.naturalWidth / image.naturalHeight;
        const width = aspect >= 1 ? size : size * aspect;
        const height = aspect >= 1 ? size / aspect : size;
        ctx.drawImage(image, -width / 2, -height / 2, width, height);
    } else {
        ctx.fillStyle = o.color;
        ctx.beginPath();
        ctx.arc(0, 0, o.r, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
}

function frame(now) {
    requestAnimationFrame(frame);

    let dt = Math.min(0.05, (now - last) / 1000);

    last = now;
    clock += dt * 1000;

    cv.width = innerWidth;
    cv.height = innerHeight;

    ctx.clearRect(0, 0, cv.width, cv.height);

    if (state.phase === 'running' && !gameEnded) {
        if (firstRunningFrame) {
            debug('FIRST_GAME_FRAME');
            firstRunningFrame = false;
        }

        state.timeLeft -= dt;

        let d = CONFIG.DIFFICULTY[state.difficulty] || CONFIG.DIFFICULTY.medium;

        if (clock > nextSpawn) {
            debug('SPAWN_ATTEMPT');

            spawn();

            nextSpawn = clock + d.interval;
        }

        objects.forEach(o => {
            try {
                o.x += o.vx * dt;
                o.y += o.vy * dt;
                o.vy += 650 * dt;
                o.rot += o.spin * dt;

                draw(o);
            } catch (error) {
                console.error(
                    'Unable to render game object:',
                    error
                );

                o.dead = true;
            }
        });

        objects = objects.filter(
            o =>
                !o.dead &&
                o.x > -100 &&
                o.x < cv.width + 100 &&
                o.y < cv.height + 120
        );

        if (state.timeLeft <= 0) {
            endGame('TIME');
        } else if (clock - lastReport > 500) {
            report();
            lastReport = clock;
        }
    } else {
        firstRunningFrame = true;
    }

    effects = effects.filter(e => e.until > clock);

    effects.forEach(e => {
        let total = e.boom ? 650 : 2300;
        let a = (e.until - clock) / total;

        ctx.globalAlpha = a;
        ctx.strokeStyle = e.color;
        ctx.lineWidth = e.boom ? 10 : 5;

        ctx.beginPath();

        ctx.arc(
            e.x,
            e.y,
            (1 - a) * (e.boom ? 100 : 75) + 20,
            0,
            Math.PI * 2
        );

        ctx.stroke();
    });

    ctx.globalAlpha = 1;

    if (blade.length > 1) {
        ctx.lineCap = 'round';

        for (let i = 1; i < blade.length; i++) {
            ctx.globalAlpha = i / blade.length;
            ctx.strokeStyle = '#9dfff0';
            ctx.lineWidth = 4 + i * 1.5;

            ctx.beginPath();
            ctx.moveTo(
                blade[i - 1].x,
                blade[i - 1].y
            );
            ctx.lineTo(
                blade[i].x,
                blade[i].y
            );
            ctx.stroke();
        }

        ctx.globalAlpha = 1;
    }

    $('#score').textContent = score.toLocaleString();

    $('#lives').textContent =
        '♥'.repeat(lives) +
        '♡'.repeat(3 - lives);

    let remain = Math.max(0, state.timeLeft);

    $('#time').textContent =
        `${String(Math.floor(remain / 60)).padStart(2, '0')}:${String(Math.floor(remain % 60)).padStart(2, '0')}`;
}

requestAnimationFrame(frame);