import assert from "node:assert/strict";
import test from "node:test";
import {
    BASE,
    cleanTell,
    grade,
    MAX_STREAK_BONUS,
    MAX_TIME_BONUS,
    PLAN,
    pickRounds,
    scoreRound,
    secondsFor,
    shareText,
    shuffle,
} from "./game.js";

const seeded = (seed) => () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
};

const pool = [
    ...Array.from({ length: 7 }, (_, i) => ({
        id: `i-easy-${i}`,
        kind: "image",
        tier: "easy",
    })),
    ...Array.from({ length: 7 }, (_, i) => ({
        id: `i-hard-${i}`,
        kind: "image",
        tier: "hard",
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
        id: `t-easy-${i}`,
        kind: "text",
        tier: "easy",
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
        id: `t-hard-${i}`,
        kind: "text",
        tier: "hard",
    })),
];

test("a game is 6 image and 4 text rounds, half easy and half hard, easy first", () => {
    for (const seed of [1, 2, 3, 99]) {
        const game = pickRounds(pool, seeded(seed));
        assert.equal(game.length, PLAN.image.count + PLAN.text.count);
        assert.equal(game.filter((r) => r.kind === "image").length, 6);
        assert.equal(game.filter((r) => r.kind === "text").length, 4);
        assert.equal(game.filter((r) => r.tier === "easy").length, 5);
        assert.equal(new Set(game.map((r) => r.id)).size, 10, "no repeats");
        const firstHard = game.findIndex((r) => r.tier === "hard");
        assert.ok(
            game.slice(firstHard).every((r) => r.tier === "hard"),
            "all easy rounds come first",
        );
    }
});

test("different seeds give different games, and the AI side varies", () => {
    const a = pickRounds(pool, seeded(1))
        .map((r) => r.id)
        .join();
    const b = pickRounds(pool, seeded(2))
        .map((r) => r.id)
        .join();
    assert.notEqual(a, b);
    const sides = new Set(
        Array.from({ length: 20 }, (_, i) =>
            pickRounds(pool, seeded(i + 5)).map((r) => r.aiSide),
        ).flat(),
    );
    assert.deepEqual([...sides].sort(), ["left", "right"]);
});

test("a small pool still plays without crashing", () => {
    const small = pool.filter((r) =>
        ["i-easy-0", "i-hard-0", "t-easy-0"].includes(r.id),
    );
    const game = pickRounds(small, seeded(4));
    assert.ok(game.length >= 1 && game.length <= 3);
});

test("scoring: a hit scores the base plus speed plus streak", () => {
    const fast = scoreRound({
        tier: "easy",
        correct: true,
        secondsLeft: 15,
        seconds: 15,
        streak: 0,
    });
    assert.deepEqual(fast, {
        points: BASE.easy + MAX_TIME_BONUS,
        streak: 1,
        speed: MAX_TIME_BONUS,
        streakBonus: 0,
    });
    const slow = scoreRound({
        tier: "hard",
        correct: true,
        secondsLeft: 0,
        seconds: 15,
        streak: 0,
    });
    assert.equal(slow.points, BASE.hard);
    const third = scoreRound({
        tier: "easy",
        correct: true,
        secondsLeft: 7.5,
        seconds: 15,
        streak: 2,
    });
    assert.equal(third.speed, 25);
    assert.equal(third.streakBonus, 20);
    assert.equal(third.streak, 3);
});

test("scoring: the streak bonus is capped, a miss scores nothing and resets", () => {
    assert.equal(
        scoreRound({
            tier: "easy",
            correct: true,
            secondsLeft: 0,
            seconds: 15,
            streak: 30,
        }).streakBonus,
        MAX_STREAK_BONUS,
    );
    assert.deepEqual(
        scoreRound({
            tier: "hard",
            correct: false,
            secondsLeft: 10,
            seconds: 15,
            streak: 4,
        }),
        { points: 0, streak: 0, speed: 0, streakBonus: 0 },
    );
    assert.equal(
        scoreRound({
            tier: "easy",
            correct: true,
            secondsLeft: -3,
            seconds: 15,
            streak: 0,
        }).speed,
        0,
        "no negative time",
    );
    assert.equal(
        scoreRound({
            tier: "easy",
            correct: true,
            secondsLeft: 99,
            seconds: 15,
            streak: 0,
        }).speed,
        MAX_TIME_BONUS,
        "no more than the maximum",
    );
});

test("each kind has its own timer, and grades cover every score", () => {
    assert.equal(secondsFor({ kind: "image" }), 15);
    assert.equal(secondsFor({ kind: "text" }), 20);
    assert.equal(grade(10, 10), "Machine whisperer");
    assert.equal(grade(8, 10), "Sharp eye");
    assert.equal(grade(6, 10), "Better than most");
    assert.equal(grade(4, 10), "Coin flip");
    assert.equal(grade(1, 10), "The AI has your number");
    assert.equal(grade(0, 0), "The AI has your number");
});

test("tells written for image 1 and image 2 read naturally in the game", () => {
    assert.equal(
        cleanTell("Image 2 features a spider with four legs."),
        "The AI image features a spider with four legs.",
    );
    assert.equal(
        cleanTell("The frog in image 2 has an extra limb, unlike image 1."),
        "The frog in the AI image has an extra limb, unlike the real photo.",
    );
    assert.equal(
        cleanTell("Looks fine. Image 2 shows floating feet."),
        "Looks fine. The AI image shows floating feet.",
    );
    assert.equal(cleanTell("No numbers here."), "No numbers here.");
});

test("shuffle keeps every item", () => {
    assert.deepEqual(
        [...shuffle([1, 2, 3, 4, 5], seeded(3))].sort(),
        [1, 2, 3, 4, 5],
    );
});

test("share text carries the result and the link", () => {
    const t = shareText(1234, 7, 10, 4, "https://example.com/");
    assert.match(t, /1234/);
    assert.match(t, /7\/10/);
    assert.match(t, /streak 4/);
    assert.match(t, /https:\/\/example.com\//);
});
