import {
    cleanTell,
    grade,
    pickRounds,
    scoreRound,
    secondsFor,
    shareText,
} from "./game.js";

const $app = document.getElementById("app");
const BEST_KEY = "spotthefake.best";

const esc = (s) =>
    String(s ?? "").replace(
        /[&<>"']/g,
        (c) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[c],
    );

const state = {
    screen: "start",
    error: "",
    data: null,
    game: null,
    answer: null, // set once the current round is answered
    best: load(),
};

function load() {
    try {
        return JSON.parse(localStorage.getItem(BEST_KEY)) ?? null;
    } catch {
        return null;
    }
}

let timer = null;
let deadline = 0;

// --- flow ------------------------------------------------------------------------

function start() {
    const list = pickRounds(state.data.rounds);
    state.game = {
        list,
        index: 0,
        score: 0,
        streak: 0,
        bestStreak: 0,
        correct: 0,
        results: [],
    };
    state.answer = null;
    state.screen = "round";
    beginRound();
}

function beginRound() {
    const g = state.game;
    state.answer = null;
    render();
    preload(g.list[g.index + 1]);
    deadline = performance.now() + secondsFor(g.list[g.index]) * 1000;
    clearInterval(timer);
    timer = setInterval(tick, 100);
}

function tick() {
    const left = (deadline - performance.now()) / 1000;
    const round = state.game.list[state.game.index];
    const bar = document.getElementById("bar");
    const clock = document.getElementById("clock");
    if (bar)
        bar.style.width = `${Math.max(0, (left / secondsFor(round)) * 100)}%`;
    if (clock) clock.textContent = String(Math.max(0, Math.ceil(left)));
    if (bar && left < 5) bar.classList.add("low");
    if (left <= 0) answer(null);
}

function answer(side) {
    if (state.answer) return;
    clearInterval(timer);
    const g = state.game;
    const round = g.list[g.index];
    const secondsLeft = Math.max(0, (deadline - performance.now()) / 1000);
    const correct = side === round.aiSide;
    const result = scoreRound({
        tier: round.tier,
        correct,
        secondsLeft,
        seconds: secondsFor(round),
        streak: g.streak,
    });
    g.score += result.points;
    g.streak = result.streak;
    g.bestStreak = Math.max(g.bestStreak, g.streak);
    if (correct) g.correct += 1;
    g.results.push(side === null ? "timeout" : correct ? "hit" : "miss");
    state.answer = { side, correct, timeout: side === null, ...result };
    render();
}

function next() {
    const g = state.game;
    g.index += 1;
    if (g.index >= g.list.length) return finish();
    beginRound();
}

function finish() {
    const g = state.game;
    if (!state.best || g.score > state.best.score) {
        state.best = {
            score: g.score,
            correct: g.correct,
            total: g.list.length,
        };
        try {
            localStorage.setItem(BEST_KEY, JSON.stringify(state.best));
        } catch {}
    }
    state.screen = "end";
    render();
}

function preload(round) {
    for (const item of [round?.real, round?.fake]) {
        if (item?.src) new Image().src = item.src;
    }
}

// --- views -----------------------------------------------------------------------

const side = (round, which) =>
    round.aiSide === which ? round.fake : round.real;

function card(round, which) {
    const item = side(round, which);
    const label = which === "left" ? "A" : "B";
    const a = state.answer;
    let cls = "";
    let badge = "";
    if (a) {
        const isAi = round.aiSide === which;
        cls = `${isAi ? "ai" : "real"} ${a.side === which ? "picked" : ""}`;
        badge = `<span class="badge ${isAi ? "ai" : "real"}">${isAi ? "AI-generated" : "Real"}</span>`;
    }
    const body =
        round.kind === "image"
            ? `<img src="${esc(item.src)}" alt="Option ${label}" draggable="false">`
            : `<p>${esc(item.text)}</p>`;
    return `<button class="choice ${round.kind} ${cls}" data-act="pick" data-side="${which}" aria-label="Option ${label} is AI" ${a ? "disabled" : ""}><span class="tag">${label}</span>${body}${badge}</button>`;
}

function credit(round) {
    const c = round.real.credit;
    const who = c.author ? ` by ${esc(c.author)}` : "";
    const kind = round.kind === "image" ? "Real photo" : "Real sentence";
    return `${kind}: <a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.title)}</a>${who}, <a href="${esc(c.licenseUrl ?? c.url)}" target="_blank" rel="noopener">${esc(c.license)}</a>`;
}

const screens = {
    start: () => `<section class="hero">
        <p class="kicker">A real-or-AI guessing game</p>
        <h2>One is real. One is AI. You have seconds to choose.</h2>
        <p>Ten rounds of photos and sentences, side by side. Every round has one real item (a Wikimedia Commons photo or a Wikipedia sentence) and one made by AI. Tap the one you think is fake before the timer runs out. Rounds start easy and get harder, and streaks and speed add to your score.</p>
        ${state.best ? `<p class="best">Your best: <b>${state.best.score}</b> points, ${state.best.correct}/${state.best.total} correct</p>` : ""}
        <button class="btn primary big" data-act="start" ${state.data ? "" : "disabled"}>${state.data ? "Play" : "Loading…"}</button>
        <p class="fine">No sign-in needed. All fakes were generated ahead of time with Pollinations.</p>
    </section>`,

    round() {
        const g = state.game;
        const round = g.list[g.index];
        const a = state.answer;
        const seconds = secondsFor(round);
        return `<section class="round">
            <div class="hud"><span>Round <b>${g.index + 1}</b>/${g.list.length}</span><span class="tier ${round.tier}">${round.tier}</span><span>Score <b>${g.score}</b></span><span>Streak <b>${g.streak}</b></span></div>
            <div class="timer"><div class="track"><i id="bar" style="width:${a ? 0 : 100}%"></i></div><b id="clock">${a ? 0 : seconds}</b></div>
            <h2 class="q">${round.kind === "image" ? "Which photo was made by AI?" : "Which sentence was written by AI?"}</h2>
            <div class="pair ${round.kind}">${card(round, "left")}${card(round, "right")}</div>
            ${a ? reveal(round) : `<p class="fine center">Tap your answer, or press A or B.</p>`}
        </section>`;
    },

    end() {
        const g = state.game;
        const isBest = state.best && state.best.score === g.score;
        return `<section class="hero center">
            <p class="kicker">${grade(g.correct, g.list.length)}</p>
            <h2>${g.correct} of ${g.list.length} correct</h2>
            <p class="bigscore">${g.score}<span> points</span></p>
            <div class="dots">${g.results.map((r, i) => `<i class="${r}" title="Round ${i + 1}: ${r}"></i>`).join("")}</div>
            <p>Best streak: <b>${g.bestStreak}</b>${isBest ? ` · <b>New personal best</b>` : state.best ? ` · Personal best: ${state.best.score}` : ""}</p>
            <div class="actions"><button class="btn primary" data-act="start">Play again</button><button class="btn" data-act="share">Copy my score</button></div>
            <p class="fine" id="shared" role="status"></p>
        </section>`;
    },
};

function reveal(round) {
    const a = state.answer;
    const g = state.game;
    const headline = a.timeout
        ? "Time's up"
        : a.correct
          ? "You spotted it"
          : "Fooled";
    const detail = a.correct
        ? `+${a.points} <span class="fine">(${a.points - a.speed - a.streakBonus} base, ${a.speed} speed${a.streakBonus ? `, ${a.streakBonus} streak` : ""})</span>`
        : a.timeout
          ? "No points"
          : "No points, streak reset";
    return `<div class="reveal ${a.correct ? "good" : "bad"}" role="status">
        <div class="verdict"><b>${headline}</b><span>${detail}</span></div>
        <p><b>A likely giveaway:</b> ${esc(cleanTell(round.tell))} <span class="fine">(Written by a model comparing the two.)</span></p>
        <p class="fine">${credit(round)}. AI item made with <code>${esc(round.fake.model)}</code>.</p>
        <button class="btn primary big" data-act="next" id="next">${g.index + 1 === g.list.length ? "See my result" : "Next round"}</button>
    </div>`;
}

function render() {
    $app.innerHTML = `<header><h1>Spot the Fake</h1></header>${state.error ? `<div class="error" role="alert">${esc(state.error)}</div>` : ""}${(screens[state.screen] ?? screens.start)()}`;
    if (state.answer)
        document.getElementById("next")?.focus({ preventScroll: true });
}

// --- events ----------------------------------------------------------------------

const actions = {
    start,
    pick: ({ side }) => answer(side),
    next,
    async share() {
        const g = state.game;
        const text = shareText(
            g.score,
            g.correct,
            g.list.length,
            g.bestStreak,
            location.href.split("#")[0],
        );
        try {
            await navigator.clipboard.writeText(text);
            document.getElementById("shared").textContent =
                "Copied. Paste it anywhere.";
        } catch {
            document.getElementById("shared").textContent = text;
        }
    },
};

$app.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (el && !el.disabled) actions[el.dataset.act]?.(el.dataset);
});

document.addEventListener("keydown", (e) => {
    if (state.screen !== "round") return;
    const key = e.key.toLowerCase();
    if (!state.answer && (key === "a" || key === "arrowleft")) answer("left");
    else if (!state.answer && (key === "b" || key === "arrowright"))
        answer("right");
});

(async () => {
    render();
    try {
        const res = await fetch("data/rounds.json");
        if (!res.ok) throw new Error(`rounds.json ${res.status}`);
        state.data = await res.json();
        for (const r of state.data.rounds.slice(0, 4)) preload(r);
    } catch (e) {
        state.error = `Could not load the rounds (${e.message}). Reload to try again.`;
    }
    render();
})();
