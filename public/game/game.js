import { CONFIG } from './config.js';
import { segmentCircle } from './collision.js';

const cv = document.querySelector('#game');
const ctx = cv.getContext('2d');
const $ = s => document.querySelector(s);

const entityImages = new Map();
const hitEffectAssets = {};
const effectCategories = ['hit', 'bonus', 'penalty'];
const AUDIO_POOL_SIZE = 4;
let audioUnlocked = false;
let audioPoolCursor = new WeakMap();

function createAudioPool(src, size = AUDIO_POOL_SIZE) {
    return Array.from({ length: size }, () => {
        const audio = new Audio();
        audio.preload = 'auto';
        audio.src = src;
        audio.load();
        audio.addEventListener('error', () => {
            console.warn('[Defense of Hogwarts] Audio asset failed to load:', src, audio.error);
        });
        return audio;
    });
}

for (const category of effectCategories) {
    const visual = new Image();
    visual.src = `/assets/effects/${category}/visual.png`;
    const scoreImage = new Image();
    scoreImage.src = `/assets/effects/${category}/score.png`;
    hitEffectAssets[category] = {
        visual,
        score: scoreImage,
        audioPool: createAudioPool(`/assets/effects/${category}/sound.ogg`)
    };
}

const endingAudio = {
    TIME: createAudioPool('/assets/effects/ending/success.ogg', 1),
    LIVES_DEPLETED: createAudioPool('/assets/effects/ending/fail.ogg', 1)
};
const EFFECT_LIFETIME_MS = 2000;
const EFFECT_FADE_START_MS = 1500;

function allAudioElements() {
    return [
        ...effectCategories.flatMap(category => hitEffectAssets[category].audioPool),
        ...Object.values(endingAudio).flat()
    ];
}

// Browsers require a user gesture on the game page before scripted audio can play.
// Prime every reusable audio element from the explicit Enable Sound button.
async function unlockAudio() {
    const button = $('#enableAudio');
    const audios = allAudioElements();
    if (!audios.length) return;

    button.disabled = true;
    button.textContent = 'Enabling sound…';

    const results = await Promise.all(audios.map(async audio => {
        audio.muted = true;
        audio.currentTime = 0;
        try {
            await audio.play();
            audio.pause();
            audio.currentTime = 0;
            audio.muted = false;
            return true;
        } catch (error) {
            audio.pause();
            audio.muted = false;
            console.warn('[Defense of Hogwarts] Could not unlock audio resource:', audio.currentSrc || audio.src, error.name, error.message);
            return false;
        }
    }));

    // One missing/corrupt file must not prevent the other sound effects from working.
    audioUnlocked = results.some(Boolean);
    if (audioUnlocked) {
        button.textContent = 'Sound Enabled';
        button.classList.add('enabled');
        debug('AUDIO_UNLOCKED', results.filter(Boolean).length, 'of', results.length, 'audio resources');
    } else {
        button.disabled = false;
        button.textContent = 'Click to Enable Sound';
        console.warn('[Defense of Hogwarts] No audio resources could be unlocked. Check the browser console and asset requests.');
    }
}

function playAudio(pool) {
    if (!pool || !pool.length) return;
    if (!audioUnlocked) {
        debug('AUDIO_SKIPPED_NOT_UNLOCKED');
        return;
    }

    // Reuse preloaded elements instead of cloning an element whose media data may not
    // be ready. A small pool allows rapid hits to overlap without restarting each other.
    const cursor = audioPoolCursor.get(pool) || 0;
    const audio = pool[cursor % pool.length];
    audioPoolCursor.set(pool, (cursor + 1) % pool.length);

    try {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
        const result = audio.play();
        if (result && typeof result.catch === 'function') {
            result.catch(error => {
                console.warn('[Defense of Hogwarts] Audio playback failed:', audio.currentSrc || audio.src, error.name, error.message);
            });
        }
    } catch (error) {
        console.warn('[Defense of Hogwarts] Audio playback failed:', audio.currentSrc || audio.src, error);
    }
}

$('#enableAudio')?.addEventListener('click', unlockAudio);

[...CONFIG.ENTITIES, CONFIG.SPECIAL_ENTITY, CONFIG.PENALTY_ENTITY].forEach(entity => {
    const image = new Image();
    image.src = entity.asset;
    entityImages.set(entity.name, image);
});

let ws, state = { phase: 'idle', timeLeft: 150 }, objects = [], effects = [], blade = [], bladePointCount = 0, prev = null, score = 0, lives = 3, bombs = 0, last = performance.now(), clock = 0, nextSpawn = 0, lastReport = 0, firstRunningFrame = true, gameEnded = false, countdownTimer = null;

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
        bladePointCount = 0;
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
    if (reason === 'TIME' || reason === 'LIVES_DEPLETED') playAudio(endingAudio[reason]);

    clearTimeout(countdownTimer);
    countdownTimer = null;

    prev = null;
    blade = [];
    bladePointCount = 0;

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
        blade = [];
        bladePointCount = 0;
        return;
    }

    if (!m.detected) {
        prev = null;
        blade = [];
        bladePointCount = 0;
        return;
    }

    let p = {
        x: m.x * cv.width,
        y: m.y * cv.height
    };

    if (prev && state.phase === 'running') {
        objects.forEach(o => {
            if (!o.dead && segmentCircle(prev, p, o, o.r)) {
                // Register at most once and preserve the collision target position before removal.
                hit(o, { x: o.x, y: o.y });
            }
        });
    }

    prev = p;

    blade.push({
        ...p,
        at: clock,
        // Assign sparkle metadata once per trail point so its position never jitters per frame.
        sparkle: bladePointCount++ % 3 === 0 ? {
            offsetX: (Math.random() - 0.5) * 10,
            offsetY: (Math.random() - 0.5) * 10,
            size: 2 + Math.random() * 3,
            white: Math.random() < 0.16
        } : null
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

function hit(o, hitPosition = { x: o.x, y: o.y }) {
    if (gameEnded || state.phase !== 'running' || o.dead) return;

    // Mark dead before scoring/effects so overlapping laser segments cannot double-register.
    o.dead = true;
    const category = o.type === 'bomb' ? 'penalty' : o.type === 'star' ? 'bonus' : 'hit';
    const assets = hitEffectAssets[category];

    if (o.type === 'bomb') {
        score = Math.max(0, score + CONFIG.SCORES.bomb);
        lives--;
        bombs++;
    } else {
        score += o.type === 'star' ? CONFIG.SCORES.star : CONFIG.SCORES.fruit;
    }

    // Use elapsed time so effects remain readable across different frame rates.
    effects.push({
        category,
        x: hitPosition.x,
        y: hitPosition.y,
        visual: assets.visual,
        scoreImage: assets.score,
        createdAt: performance.now(),
        duration: EFFECT_LIFETIME_MS
    });
    playAudio(assets.audioPool);

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

    effects = effects.filter(e => now - e.createdAt < e.duration);
    effects.forEach(e => {
        const elapsed = Math.max(0, now - e.createdAt);
        const fadeProgress = Math.max(0, Math.min(1,
            (elapsed - EFFECT_FADE_START_MS) / (e.duration - EFFECT_FADE_START_MS)
        ));
        const opacity = 1 - fadeProgress;
        const visual = e.visual;
        const scoreImage = e.scoreImage;
        const visualSize = Math.min(220, Math.max(140, cv.width * 0.11));
        const visualAspect = visual?.naturalWidth > 0 && visual?.naturalHeight > 0
            ? visual.naturalWidth / visual.naturalHeight : 1;
        const visualW = visualSize;
        const visualH = visualSize / visualAspect;
        const scoreW = Math.min(140, Math.max(90, cv.width * 0.075));
        const scoreAspect = scoreImage?.naturalWidth > 0 && scoreImage?.naturalHeight > 0
            ? scoreImage.naturalWidth / scoreImage.naturalHeight : 1;
        const scoreWActual = scoreW;
        const scoreH = scoreW / scoreAspect;
        const gap = 8;
        let visualX = e.x - visualW / 2;
        let visualY = e.y - visualH / 2;
        let scoreX = e.x + visualW / 2 + gap;
        let scoreY = e.y - scoreH / 2;
        // Keep the paired graphics near the hit while avoiding unnecessary screen-edge clipping.
        if (scoreX + scoreWActual > cv.width - 6) {
            scoreX = e.x - visualW / 2 - gap - scoreWActual;
        }
        visualX = Math.max(0, Math.min(cv.width - visualW, visualX));
        visualY = Math.max(0, Math.min(cv.height - visualH, visualY));
        scoreX = Math.max(0, Math.min(cv.width - scoreWActual, scoreX));
        scoreY = Math.max(0, Math.min(cv.height - scoreH, scoreY));

        ctx.save();
        ctx.globalAlpha = opacity;
        if (visual?.complete && visual.naturalWidth > 0) {
            ctx.drawImage(visual, visualX, visualY, visualW, visualH);
        }
        if (scoreImage?.complete && scoreImage.naturalWidth > 0) {
            ctx.drawImage(scoreImage, scoreX, scoreY, scoreWActual, scoreH);
        }
        ctx.restore();
    });

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

    // Small four-pointed sparkles are anchored to trail points and fade with them.
    // save/restore isolates sparkle styling from the rest of the Canvas renderer.
    if (blade.length > 1 && state.phase === 'running' && !gameEnded) {
        ctx.save();
        for (let i = 0; i < blade.length; i++) {
            const point = blade[i];
            if (!point.sparkle) continue;

            const trailOpacity = i / blade.length;
            if (trailOpacity <= 0) continue;

            const sparkle = point.sparkle;
            const x = point.x + sparkle.offsetX;
            const y = point.y + sparkle.offsetY;
            const size = sparkle.size;

            ctx.globalAlpha = trailOpacity * (sparkle.white ? 0.9 : 0.78);
            ctx.fillStyle = sparkle.white ? '#ffffff' : '#9dfff0';
            ctx.beginPath();
            ctx.moveTo(x, y - size);
            ctx.lineTo(x + size * 0.48, y);
            ctx.lineTo(x, y + size);
            ctx.lineTo(x - size * 0.48, y);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
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