const API_URL = '/api';

function safeJsonParse(value, fallback = []) {
    if (value === undefined || value === null) return fallback;
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '') return fallback;
        try {
            return JSON.parse(trimmed);
        } catch (e) {
            return fallback;
        }
    }
    return fallback;
}

function parseOrderHistory(value) {
    return safeJsonParse(value, []);
}

function getSafeStatus(val) {
    return String(val || '').trim().toLowerCase();
}

function normalizarNome(nome) {
    if (!nome) return null;
    const normalized = String(nome).trim();
    if (normalized.toLowerCase() === 'sistema') return null;
    return normalized.toUpperCase();
}

function diffMinsCalc(start, end) {
    if (!start || !end) return 0;
    const d = (new Date(end) - new Date(start)) / 60000;
    return d > 0 ? d : 0;
}

function formatLeadTime(mins) {
    if (!mins || isNaN(mins) || mins <= 0) return '0m';
    if (mins >= 1440) return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
    if (mins >= 60) return `${Math.floor(mins / 60)}h ${Math.floor(mins % 60)}m`;
    return `${Math.round(mins)}m`;
}

function formatAvgTime(mins) {
    if (!mins || isNaN(mins) || mins <= 0) return '0m';
    if (mins >= 1440) return `${(mins / 1440).toFixed(1)} dias`;
    if (mins >= 60) return `${(mins / 60).toFixed(1)} hrs`;
    return `${Math.round(mins)} min`;
}

async function fetchWorkflow() {
    const response = await fetch(`${API_URL}/config/workflow`);
    if (!response.ok) {
        throw new Error(`Erro ${response.status} ao carregar workflow`);
    }
    return response.json();
}

async function fetchOrders() {
    const response = await fetch(`${API_URL}/pedidos`);
    if (!response.ok) {
        throw new Error(`Erro ${response.status} ao carregar pedidos`);
    }
    return response.json();
}

async function fetchWorkflowAndOrders() {
    const [wfRes, ordRes] = await Promise.all([fetchWorkflow(), fetchOrders()]);
    const workflow = wfRes && wfRes.dados ? (typeof wfRes.dados === 'string' ? safeJsonParse(wfRes.dados, []) : wfRes.dados) : [];
    return { workflow, orders: ordRes || [] };
}
