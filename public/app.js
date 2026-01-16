/**
 * ORA Scraper Admin UI - Frontend JavaScript
 */

// State
let sources = [];
let settings = {};
let editingSourceId = null;

// DOM Elements
const runNowBtn = document.getElementById('runNowBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const batchSizeInput = document.getElementById('batchSize');
const intervalHoursInput = document.getElementById('intervalHours');
const enabledToggle = document.getElementById('enabledToggle');
const saveScheduleBtn = document.getElementById('saveScheduleBtn');
const addSourceBtn = document.getElementById('addSourceBtn');
const sourcesList = document.getElementById('sourcesList');
const sourceModal = document.getElementById('sourceModal');
const modalTitle = document.getElementById('modalTitle');
const sourceTypeSelect = document.getElementById('sourceType');
const queryLabel = document.getElementById('queryLabel');
const sourceQueryInput = document.getElementById('sourceQuery');
const cancelModalBtn = document.getElementById('cancelModalBtn');
const saveSourceBtn = document.getElementById('saveSourceBtn');

// API calls
async function fetchJSON(url, options = {}) {
    const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function loadStats() {
    try {
        const stats = await fetchJSON('/api/jobs/stats');
        document.getElementById('statScraped').textContent = stats.imagesScraped || 0;
        document.getElementById('statUploaded').textContent = stats.imagesUploaded || 0;
        document.getElementById('statFiltered').textContent = stats.qualityFiltered || 0;
        document.getElementById('statFailed').textContent = stats.imagesFailed || 0;
    } catch (e) {
        console.error('Failed to load stats:', e);
    }
}

async function loadStatus() {
    try {
        const status = await fetchJSON('/api/jobs/status');
        const enabled = status.enabled;

        statusDot.className = `status-dot ${enabled ? 'enabled' : 'disabled'}`;

        if (status.lastRunAt) {
            const lastRun = new Date(status.lastRunAt);
            const nextRun = status.nextRunAt ? new Date(status.nextRunAt) : null;

            if (enabled && nextRun) {
                const hoursUntil = Math.round((nextRun - new Date()) / (1000 * 60 * 60) * 10) / 10;
                statusText.textContent = hoursUntil > 0
                    ? `Next run in ${hoursUntil}h`
                    : 'Running soon...';
            } else if (!enabled) {
                statusText.textContent = 'Disabled';
            } else {
                statusText.textContent = `Last: ${lastRun.toLocaleTimeString()}`;
            }
        } else {
            statusText.textContent = enabled ? 'Waiting for first run' : 'Disabled';
        }
    } catch (e) {
        console.error('Failed to load status:', e);
        statusText.textContent = 'Error loading status';
    }
}

async function loadSettings() {
    try {
        settings = await fetchJSON('/api/sources/settings/schedule');
        batchSizeInput.value = settings.batchSize;
        intervalHoursInput.value = settings.intervalHours;
        enabledToggle.className = `toggle ${settings.enabled ? 'active' : ''}`;
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
}

async function saveSettings() {
    try {
        const newSettings = {
            batchSize: parseInt(batchSizeInput.value, 10),
            intervalHours: parseInt(intervalHoursInput.value, 10),
            enabled: enabledToggle.classList.contains('active'),
        };

        settings = await fetchJSON('/api/sources/settings/schedule', {
            method: 'PUT',
            body: JSON.stringify(newSettings),
        });

        alert('Schedule saved!');
        loadStatus();
    } catch (e) {
        console.error('Failed to save settings:', e);
        alert('Failed to save settings');
    }
}

async function loadSources() {
    try {
        sources = await fetchJSON('/api/sources');
        renderSources();
    } catch (e) {
        console.error('Failed to load sources:', e);
        sourcesList.innerHTML = '<div class="source-item" style="justify-content: center; color: var(--text-muted);">Failed to load sources</div>';
    }
}

function renderSources() {
    if (sources.length === 0) {
        sourcesList.innerHTML = '<div class="source-item" style="justify-content: center; color: var(--text-muted);">No sources configured. Add one to get started!</div>';
        return;
    }

    sourcesList.innerHTML = sources.map(s => `
        <div class="source-item">
            <div class="source-info">
                <span class="source-type ${s.type}">${s.type}</span>
                <div>
                    <div class="source-query">${escapeHtml(s.query)}</div>
                    <div class="source-stats">${s.totalScraped || 0} images • ${s.lastScrapedAt ? 'Last: ' + new Date(s.lastScrapedAt).toLocaleDateString() : 'Never run'}</div>
                </div>
            </div>
            <div class="source-actions">
                <div class="toggle ${s.enabled ? 'active' : ''}" onclick="toggleSource(${s.id}, ${!s.enabled})"></div>
                <button class="btn btn-secondary" onclick="editSource(${s.id})">Edit</button>
                <button class="btn btn-danger" onclick="deleteSource(${s.id}, event)">Del</button>
            </div>
        </div>
    `).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function toggleSource(id, enabled) {
    try {
        await fetchJSON(`/api/sources/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ enabled }),
        });
        loadSources();
    } catch (e) {
        console.error('Failed to toggle source:', e);
    }
}

function editSource(id) {
    const source = sources.find(s => s.id === id);
    if (!source) return;

    editingSourceId = id;
    modalTitle.textContent = 'Edit Source';
    sourceTypeSelect.value = source.type;
    sourceQueryInput.value = source.query;
    updateQueryLabel();
    sourceModal.classList.add('visible');
}

// Confirm modal state
let pendingDeleteId = null;
const confirmModal = document.getElementById('confirmModal');
const confirmCancelBtn = document.getElementById('confirmCancelBtn');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

function deleteSource(id, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }

    pendingDeleteId = id;
    confirmModal.classList.add('visible');
}

async function confirmDelete() {
    if (!pendingDeleteId) return;

    try {
        await fetchJSON(`/api/sources/${pendingDeleteId}`, { method: 'DELETE' });
        loadSources();
    } catch (e) {
        console.error('Failed to delete source:', e);
        alert('Failed to delete source');
    }

    closeConfirmModal();
}

function closeConfirmModal() {
    confirmModal.classList.remove('visible');
    pendingDeleteId = null;
}

// Confirm modal event listeners
confirmCancelBtn.addEventListener('click', closeConfirmModal);
confirmDeleteBtn.addEventListener('click', confirmDelete);

function openAddModal() {
    editingSourceId = null;
    modalTitle.textContent = 'Add Source';
    sourceTypeSelect.value = 'unsplash';
    sourceQueryInput.value = '';
    updateQueryLabel();
    sourceModal.classList.add('visible');
}

function closeModal() {
    sourceModal.classList.remove('visible');
    editingSourceId = null;
}

function updateQueryLabel() {
    const type = sourceTypeSelect.value;
    switch (type) {
        case 'unsplash':
            queryLabel.textContent = 'Search Query';
            sourceQueryInput.placeholder = 'e.g., interior design';
            break;
        case 'reddit':
            queryLabel.textContent = 'Subreddit';
            sourceQueryInput.placeholder = 'e.g., RoomPorn';
            break;
        case 'url':
            queryLabel.textContent = 'Website URL';
            sourceQueryInput.placeholder = 'e.g., https://example.com';
            break;
    }
}

async function saveSource() {
    const type = sourceTypeSelect.value;
    const query = sourceQueryInput.value.trim();

    if (!query) {
        alert('Please enter a query');
        return;
    }

    try {
        if (editingSourceId) {
            await fetchJSON(`/api/sources/${editingSourceId}`, {
                method: 'PUT',
                body: JSON.stringify({ type, query }),
            });
        } else {
            await fetchJSON('/api/sources', {
                method: 'POST',
                body: JSON.stringify({ type, query }),
            });
        }

        closeModal();
        loadSources();
    } catch (e) {
        console.error('Failed to save source:', e);
        alert('Failed to save source');
    }
}

async function runNow() {
    try {
        runNowBtn.textContent = '⏳ Starting...';
        runNowBtn.disabled = true;

        await fetchJSON('/api/jobs/run', { method: 'POST' });

        runNowBtn.textContent = '✓ Started!';
        setTimeout(() => {
            runNowBtn.textContent = '▶ Run Now';
            runNowBtn.disabled = false;
            loadStats();
            loadStatus();
        }, 2000);
    } catch (e) {
        console.error('Failed to start job:', e);
        runNowBtn.textContent = '✗ Failed';
        setTimeout(() => {
            runNowBtn.textContent = '▶ Run Now';
            runNowBtn.disabled = false;
        }, 2000);
    }
}

// Event listeners
runNowBtn.addEventListener('click', runNow);
saveScheduleBtn.addEventListener('click', saveSettings);
addSourceBtn.addEventListener('click', openAddModal);
cancelModalBtn.addEventListener('click', closeModal);
saveSourceBtn.addEventListener('click', saveSource);
sourceTypeSelect.addEventListener('change', updateQueryLabel);
enabledToggle.addEventListener('click', () => {
    enabledToggle.classList.toggle('active');
});

// Initial load
loadStats();
loadStatus();
loadSettings();
loadSources();

// Refresh stats every 30 seconds
setInterval(() => {
    loadStats();
    loadStatus();
}, 30000);
