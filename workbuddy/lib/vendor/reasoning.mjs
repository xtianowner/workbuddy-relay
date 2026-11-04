const owns = (value, key) => Object.hasOwn(value, key);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const effort = (value) => typeof value === "string" && /^[a-z][a-z0-9_-]{0,31}$/.test(value);
const unknownCapability = () => ({
    reasoning: null,
    effortLevels: null,
    defaultEffort: null,
    defaultEnabled: null,
    canDisable: null,
    effortSelection: "unknown",
    budget: null,
    source: "unknown",
});
/** null means no valid declaration; [] is an explicitly empty declaration. */
function levels(value, codex = false) {
    if (!Array.isArray(value) || value.length > 64)
        return null;
    const raw = value.map(item => codex && object(item) ? item.effort : item);
    // Do not turn malformed input into an empty (negative) capability declaration.
    if (raw.some(item => !effort(item)))
        return null;
    return [...new Set(raw)];
}
function declaredDefault(value, available, unrestricted = false) {
    return effort(value) && (unrestricted || available?.includes(value)) ? value : null;
}
function fromCodex(model) {
    const values = levels(model.supported_reasoning_levels, true);
    if (!values)
        return unknownCapability();
    return {
        ...unknownCapability(),
        source: "codex-manifest",
        effortSelection: "declared",
        effortLevels: values,
        reasoning: values.some(value => value !== "none") ? true : values.length ? false : null,
        defaultEffort: declaredDefault(model.default_reasoning_level, values),
        canDisable: values.includes("none") ? true : null,
    };
}
function fromOpenRouter(value) {
    const result = { ...unknownCapability(), source: "openrouter", reasoning: true };
    if (owns(value, "mandatory") && typeof value.mandatory !== "boolean")
        return unknownCapability();
    if (owns(value, "default_enabled") && typeof value.default_enabled !== "boolean")
        return unknownCapability();
    if (owns(value, "supports_max_tokens") && typeof value.supports_max_tokens !== "boolean")
        return unknownCapability();
    if (typeof value.mandatory === "boolean")
        result.canDisable = !value.mandatory;
    if (typeof value.default_enabled === "boolean")
        result.defaultEnabled = value.default_enabled;
    if (value.mandatory === true && value.default_enabled === false)
        return unknownCapability();
    if (value.supports_max_tokens === true)
        result.budget = {};
    if (!owns(value, "supported_efforts")) {
        result.effortSelection = "unavailable";
        return result;
    }
    if (value.supported_efforts === null) {
        result.effortSelection = "unrestricted";
        result.defaultEffort = declaredDefault(value.default_effort, null, true);
        return result;
    }
    const values = levels(value.supported_efforts);
    if (!values)
        return unknownCapability();
    // Contradictory metadata is not a usable supported-effort list.
    if (value.mandatory === true && values.includes("none"))
        return unknownCapability();
    result.effortLevels = values;
    result.effortSelection = "declared";
    result.defaultEffort = declaredDefault(value.default_effort, values);
    if (values.includes("none") && result.canDisable === null)
        result.canDisable = true;
    return result;
}
function fromModelsDev(model) {
    if (owns(model, "reasoning") && typeof model.reasoning !== "boolean")
        return unknownCapability();
    const options = model.reasoning_options;
    if (!Array.isArray(options) || options.length > 16)
        return unknownCapability();
    if (model.reasoning === false && options.length > 0)
        return unknownCapability();
    const result = { ...unknownCapability(), source: "models-dev", reasoning: typeof model.reasoning === "boolean" ? model.reasoning : null };
    if (options.length > 0)
        result.reasoning = true;
    let hasEffort = false;
    for (const option of options) {
        if (!object(option))
            return unknownCapability();
        if (option.type === "effort") {
            if (hasEffort || !Array.isArray(option.values) || option.values.length > 64)
                return unknownCapability();
            // models.dev null/default mean omit/default the parameter, not "disable thinking".
            const values = option.values.filter(value => value !== null && value !== "default");
            const normalized = levels(values);
            if (!normalized)
                return unknownCapability();
            hasEffort = true;
            result.effortLevels = normalized;
            result.effortSelection = "declared";
            if (normalized.includes("none"))
                result.canDisable = true;
        }
        else if (option.type === "toggle") {
            result.canDisable = true;
        }
        else if (option.type === "budget_tokens") {
            const budget = {};
            for (const key of ["min", "max"]) {
                if (!owns(option, key))
                    continue;
                const n = option[key];
                if (typeof n !== "number" || !Number.isSafeInteger(n) || n < (key === "min" ? -1 : 0))
                    return unknownCapability();
                budget[key] = n;
            }
            if (budget.min !== undefined && budget.max !== undefined && budget.min > budget.max)
                return unknownCapability();
            result.budget = budget;
        }
        else {
            // A future option must not silently become a false claim about existing controls.
            return unknownCapability();
        }
    }
    if (!hasEffort)
        result.effortSelection = "unavailable";
    return result;
}
function capability(model) {
    if (owns(model, "supported_reasoning_levels"))
        return fromCodex(model);
    if (owns(model, "reasoning_options"))
        return fromModelsDev(model);
    if (object(model.reasoning))
        return fromOpenRouter(model.reasoning);
    if (typeof model.reasoning === "boolean") {
        return { ...unknownCapability(), reasoning: model.reasoning, source: "models-dev", effortSelection: model.reasoning ? "unknown" : "unavailable" };
    }
    return unknownCapability();
}
/**
 * Accept model rows or the common {data: []}/{models: []} list envelopes.
 * IDs remain exact and case-sensitive. Missing, malformed and contradictory metadata stays
 * unknown; duplicate IDs with conflicting declarations do not get a union of their levels.
 */
export function parseReasoningCapabilities(input) {
    const rows = Array.isArray(input) ? input : object(input) ? (Array.isArray(input.data) ? input.data : input.models) : null;
    if (!Array.isArray(rows))
        return {};
    const found = new Map();
    for (const row of rows.slice(0, 1000)) {
        if (!object(row))
            continue;
        const name = typeof row.slug === "string" ? row.slug : row.id;
        if (typeof name !== "string" || !name.trim() || name.length > 256)
            continue;
        const id = name.trim();
        const current = capability(row);
        const previous = found.get(id);
        found.set(id, previous && JSON.stringify(previous) !== JSON.stringify(current) ? unknownCapability() : current);
    }
    return Object.fromEntries(found);
}
