/**
 * Deterministic mock backend: lets the MCP server, tests, and demos run
 * with no API key. Answers are derived from a stable hash of state +
 * question, so runs are reproducible; scripted answers can be injected.
 *
 * It mirrors the real providers' confidence provenance rather than inventing
 * one: `choice`/`score` answers carry a confidence field (so their verdicts
 * read `confidenceFrom: "reported"`), `noul` answers carry none (so theirs
 * read `"estimated"`, computed from the probability).
 */
import { optionEntries, serializeState } from "../protocol.js";
export class MockBackend {
    script;
    name = "mock";
    constructor(script = {}) {
        this.script = script;
    }
    async judge(request) {
        const started = Date.now();
        const answers = request.questions.map((question, index) => this.script[question.id] ?? synthesize(request, question, index));
        return {
            answers,
            model: "jev-mock",
            latencyMs: Date.now() - started,
        };
    }
}
/** A stable pseudo-answer for one question: same inputs, same verdict. */
function synthesize(request, question, index) {
    const seed = hash(`${serializeState(request.state)}|${question.question}|${index}`);
    switch (question.type) {
        case "noul": {
            const probability = ((seed % 1000) / 1000) * 0.98 + 0.01;
            return { answer: round3(probability) };
        }
        case "choice": {
            const labels = optionEntries(question.options ?? []).map(([label]) => label);
            const winner = seed % labels.length;
            // Winner gets ~0.85, the rest split the remainder.
            const rest = labels.length > 1 ? 0.15 / (labels.length - 1) : 0;
            const distribution = {};
            labels.forEach((label, position) => {
                distribution[label] = round3(position === winner ? 0.85 : rest);
            });
            return { answer: labels[winner], distribution, confidence: 0.85 };
        }
        case "score": {
            const levels = question.levels ?? [];
            const winner = seed % levels.length;
            const rest = levels.length > 1 ? 0.15 / (levels.length - 1) : 0;
            const distribution = {};
            levels.forEach((_, position) => {
                distribution[String(position)] = round3(position === winner ? 0.85 : rest);
            });
            return {
                answer: winner,
                distribution,
                legend: Object.fromEntries(levels.map((level, position) => [String(position), level])),
                confidence: 0.8,
            };
        }
    }
}
/** FNV-1a: small, dependency-free, and stable across runs and platforms. */
function hash(text) {
    let value = 2166136261;
    for (let i = 0; i < text.length; i++) {
        value ^= text.charCodeAt(i);
        value = Math.imul(value, 16777619);
    }
    return value >>> 0;
}
function round3(value) {
    return Math.round(value * 1000) / 1000;
}
