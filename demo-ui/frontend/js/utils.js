import { elements } from './elements.js';

// Status message management
export function setStatus(message, type = "") {
    if (!elements.statusBar) return;
    elements.statusBar.textContent = message;
    elements.statusBar.className = type ? `status-bar ${type}` : "status-bar";
}

// Section visibility toggling
export function toggleSection(element, show) {
    if (!element) return;
    element.classList.toggle("hidden", !show);
}

// Format probability value
export function formatProbability(value) {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return "n/a";
    }
    return (value * 100).toFixed(1) + "%";
}

// Normalize note text (moved to noteHandling, but kept here for backward compatibility)
export function normalizeNote(text) {
    if (typeof text !== "string") return "";
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

// Populate select element with options
export function populateSelect(selectElement, values) {
    if (!selectElement) return;
    selectElement.innerHTML = "";
    values.forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        selectElement.appendChild(option);
    });
}

// Filter models by ICD version
export function filterModelsByICDVersion(models, icdVersion) {
    if (!Array.isArray(models)) return [];
    const targetVersion = icdVersion === "10" ? "10" : "9";
    return models.filter((model) => {
        const name = model.name || model;
        return name.includes(`icd${targetVersion}`) || name.includes(`ICD${targetVersion}`);
    });
}

// Sanitize folder name
export function sanitizeFolderName(name) {
    return name.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
}

