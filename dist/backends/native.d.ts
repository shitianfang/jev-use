/**
 * Jev's native wire dialect, shared verbatim by the TypeSafe direct API
 * and OpenRouter's /api/alpha/decisions: questions are a map keyed by
 * answer name; choice options are label → description; score criteria is
 * an ordered list indexed from 0.
 */
import { type Question, type State } from "../protocol.js";
import { type RawAnswer } from "./types.js";
/** One question in the native dialect. */
export type NativeWireQuestion = {
    type: "noul";
    instructions: string;
    criteria?: {
        true: string;
        false: string;
    };
} | {
    type: "choice";
    instructions: string;
    criteria: Record<string, string>;
} | {
    type: "score";
    instructions: string;
    criteria: string[];
};
/** One request body in the native dialect. */
export interface NativeBody {
    model: string;
    state: State;
    questions: Record<string, NativeWireQuestion>;
}
/** Translate one question into the native dialect. */
export declare function toNativeQuestion(question: Question): NativeWireQuestion;
/** Build the whole request body: model, state, and the questions by id. */
export declare function toNativeBody(state: State, questions: (Question & {
    id: string;
})[], model: string): NativeBody;
/**
 * Read the provider's answer map back into raw answers, in question order.
 * Anything missing or mistyped is a `BackendError` — a silently dropped
 * answer would read as a low-confidence judgment.
 */
export declare function parseNativeAnswers(backend: string, answers: unknown, questions: (Question & {
    id: string;
})[]): RawAnswer[];
