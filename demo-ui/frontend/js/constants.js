// Common OpenAI models that work with the responses API
export const LLM_MODELS = [
    "gpt-5",
    "gpt-4o",
    "gpt-4-turbo",
    "gpt-4",
    "gpt-4o-mini",
    "o1-preview",
    "o1-mini",
    "gpt-3.5-turbo",
];

export const highlightClasses = ["highlight-1", "highlight-2", "highlight-3", "highlight-4"];
export const CODE_SEARCH_DEBOUNCE_MS = 250;

export const QUOTE_TRIM_REGEX = /^["'\u201C\u201D\u2018\u2019\u00AB\u00BB\u2039\u203A\u201E\u201F]+|["'\u201C\u201D\u2018\u2019\u00AB\u00BB\u2039\u203A\u201E\u201F]+$/g;
export const TRAILING_PUNCT_REGEX = /[.,;:!?]+$/;

