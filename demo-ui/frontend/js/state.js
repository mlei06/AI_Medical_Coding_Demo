// Application state management
export const state = {
    originalNoteText: "",
    noteText: "",
    models: [],
    methods: [],
    icdCodes: [],
    cptCodes: [],
    finalizedCodes: [],
    noteFileName: null,
    selectedIcdCodeIds: new Set(),
    selectedCptCodeIds: new Set(),
    expandedCodeIds: new Set(), // Track expanded codes
    activeTab: "icd", // "icd" or "cpt"
    lookupCodeType: "icd", // "icd" or "cpt" for manual lookup
    aiSuggestedCodeType: "icd", // "icd" or "cpt" for AI suggested codes view
    pageMode: "predict", // "predict" or "review"
    mode: "local",
    llmModel: "gpt-5",
    reasoning: "",
    icdVersion: "9", // "9" or "10" - default to ICD-9 (for AI prediction)
    lookupIcdVersion: "9", // "9" or "10" - default to ICD-9 (for manual lookup)
    reviewFolders: [], // List of available output folders
    selectedReviewFolder: null, // Currently selected folder name
    loadedReviewData: null, // { note, codes, folderName }
    originalReviewCodes: null, // Snapshot of codes when folder was loaded (for change tracking) - null means not loaded yet
    originalAdmissionId: null, // Original admission ID when folder was loaded
    folderSearchTerm: "", // Search term for filtering folders by admission ID
    codeSearch: {
        icd: {
            term: "",
            results: [],
            activeIndex: -1,
            loading: false,
            seq: 0,
        },
        cpt: {
            term: "",
            results: [],
            activeIndex: -1,
            loading: false,
            seq: 0,
        },
    },
};

// Timers for code search debouncing and blur handling
export const codeSearchTimers = {
    icd: { debounce: null, blur: null },
    cpt: { debounce: null, blur: null },
};

