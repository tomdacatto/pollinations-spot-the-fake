// The rules of Spot the Fake: which rounds a game plays, scoring and streaks.
// Pure functions, no DOM.

export const PLAN = {
    image: { count: 6, seconds: 15 },
    text: { count: 4, seconds: 20 },
};
export const BASE = { easy: 100, hard: 150 };
export const MAX_TIME_BONUS = 50;
export const STREAK_BONUS = 10;
export const MAX_STREAK_BONUS = 50;

export function shuffle(list, rng = Math.random) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

// Half of each kind's rounds are easy and half hard, easy ones first, image
// and text rounds interleaved. Which side the AI item sits on is random.
export function pickRounds(rounds, rng = Math.random) {
    const chosen = {};
    for (const [kind, { count }] of Object.entries(PLAN)) {
        const pool = rounds.filter((r) => r.kind === kind);
        const half = Math.floor(count / 2);
        const easy = shuffle(
            pool.filter((r) => r.tier === "easy"),
            rng,
        ).slice(0, half);
        const hard = shuffle(
            pool.filter((r) => r.tier === "hard"),
            rng,
        ).slice(0, count - half);
        chosen[kind] = [...easy, ...hard];
    }
    const order = [];
    const queues = { image: [...chosen.image], text: [...chosen.text] };
    // Texts land on every third round, so the game alternates without a rigid pattern.
    for (let n = 0; queues.image.length || queues.text.length; n++) {
        const kind =
            (n % 5 === 2 || n % 5 === 4) && queues.text.length
                ? "text"
                : queues.image.length
                  ? "image"
                  : "text";
        order.push(queues[kind].shift());
    }
    const rank = { easy: 0, hard: 1 };
    order.sort((a, b) => rank[a.tier] - rank[b.tier]);
    return order.map((r) => ({ ...r, aiSide: rng() < 0.5 ? "left" : "right" }));
}

export const secondsFor = (round) => PLAN[round.kind].seconds;

// A miss or a timeout scores nothing and ends the streak. A hit scores the
// round's base plus a bonus for speed and a bonus for the streak so far.
export function scoreRound({ tier, correct, secondsLeft, seconds, streak }) {
    if (!correct) return { points: 0, streak: 0, speed: 0, streakBonus: 0 };
    const speed = Math.round(
        MAX_TIME_BONUS * Math.min(1, Math.max(0, secondsLeft / seconds)),
    );
    const next = streak + 1;
    const streakBonus = Math.min(MAX_STREAK_BONUS, (next - 1) * STREAK_BONUS);
    return {
        points: BASE[tier] + speed + streakBonus,
        streak: next,
        speed,
        streakBonus,
    };
}

export function grade(correct, total) {
    const share = total ? correct / total : 0;
    if (share === 1) return "Machine whisperer";
    if (share >= 0.8) return "Sharp eye";
    if (share >= 0.6) return "Better than most";
    if (share >= 0.4) return "Coin flip";
    return "The AI has your number";
}

// Tells were written comparing two images; in the game they are "the real
// photo" and "the AI image" whatever side they sit on.
export function cleanTell(text) {
    return text
        .replace(/(^|[.!?]\s+)[Ii]mage 2\b/g, "$1The AI image")
        .replace(/(^|[.!?]\s+)[Ii]mage 1\b/g, "$1The real photo")
        .replace(/\b[Ii]mage 2\b/g, "the AI image")
        .replace(/\b[Ii]mage 1\b/g, "the real photo");
}

export function shareText(score, correct, total, bestStreak, url) {
    return `I scored ${score} on Spot the Fake: ${correct}/${total} correct, best streak ${bestStreak}. Can you tell which one is AI? ${url}`;
}
