/**
 * ORA Scraper Admin UI - Main Application
 * Multi-page SPA with Firebase Authentication
 */

// ============================================
// FIREBASE CONFIG & AUTH
// ============================================

// Firebase configuration - angles-423a4 project
const firebaseConfig = {
    apiKey: "AIzaSyA65aFDlUYlYo24el93ZEdd0ErEiuQzB3A",
    authDomain: "angles-423a4.firebaseapp.com",
    projectId: "angles-423a4",
    storageBucket: "angles-423a4.firebasestorage.app",
    messagingSenderId: "1024758653829",
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

// Initialize App Check with debug token for development
// In production, use reCAPTCHA Enterprise or v3
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    // Enable debug mode for local development
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}
const appCheck = firebase.appCheck();
appCheck.activate('6LcxIFEsAAAAANSvcZkmgF24oZyvKOr1kmdInVKW', { isTokenAutoRefreshEnabled: true });

// Auth state
let currentUser = null;
let authToken = null;

// ============================================
// STATE MANAGEMENT
// ============================================

const state = {
    // Data
    sources: [],
    settings: {},
    stats: {},
    statsHistory: [],
    recentImages: [],
    failedImages: [],
    filteredImages: [],
    jobHistory: [],
    currentJob: null,

    // UI State
    currentPage: 'dashboard',
    editingSourceId: null,
    pendingDeleteId: null,
    selectedSources: new Set(),
    imagesTab: 'recent',

    // Polling
    statusInterval: null,
    progressInterval: null,
};

// ============================================
// AUTH FUNCTIONS
// ============================================

function initAuth() {
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            // User is signed in
            currentUser = user;

            // Get ID token
            try {
                authToken = await user.getIdToken();

                // Verify admin access with server
                const result = await verifyAdminAccess();
                if (result.isAdmin) {
                    showApp();
                    document.getElementById('userEmail').textContent = user.email;
                    initRouter();
                    updateDashboardStatus();

                    // Refresh token periodically
                    setInterval(async () => {
                        authToken = await user.getIdToken(true);
                    }, 50 * 60 * 1000); // Refresh every 50 minutes
                } else {
                    showLoginError('Access denied. Admin privileges required.');
                    await auth.signOut();
                }
            } catch (error) {
                console.error('Auth error:', error);
                showLoginError('Failed to verify access. Please try again.');
                await auth.signOut();
            }
        } else {
            // User is signed out
            currentUser = null;
            authToken = null;
            showLogin();
        }
    });
}

async function verifyAdminAccess() {
    const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
        },
    });

    if (!res.ok) {
        if (res.status === 403) {
            return { isAdmin: false };
        }
        throw new Error('Verification failed');
    }

    return res.json();
}

async function handleLogin(event) {
    event.preventDefault();

    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const btn = document.getElementById('loginBtn');
    const errorDiv = document.getElementById('loginError');

    btn.disabled = true;
    btn.textContent = 'Signing in...';
    errorDiv.style.display = 'none';

    try {
        await auth.signInWithEmailAndPassword(email, password);
        // onAuthStateChanged will handle the rest
    } catch (error) {
        console.error('Login error:', error);
        showLoginError(getAuthErrorMessage(error.code));
        btn.disabled = false;
        btn.textContent = 'Sign In';
    }
}

async function handleLogout() {
    try {
        await auth.signOut();
    } catch (error) {
        console.error('Logout error:', error);
        showToast('Failed to sign out', 'error');
    }
}

function showLoginError(message) {
    const errorDiv = document.getElementById('loginError');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}

function getAuthErrorMessage(code) {
    switch (code) {
        case 'auth/user-not-found':
        case 'auth/wrong-password':
            return 'Invalid email or password';
        case 'auth/too-many-requests':
            return 'Too many failed attempts. Please try again later.';
        case 'auth/user-disabled':
            return 'This account has been disabled';
        default:
            return 'Authentication failed. Please try again.';
    }
}

function showLogin() {
    document.getElementById('loginPage').style.display = 'flex';
    document.getElementById('appLayout').style.display = 'none';
}

function showApp() {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('appLayout').style.display = 'flex';
}

// ============================================
// API UTILITIES (with auth token)
// ============================================

async function api(url, options = {}) {
    if (!authToken) {
        throw new Error('Not authenticated');
    }

    const res = await fetch(url, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
        },
        ...options,
    });

    if (res.status === 401 || res.status === 403) {
        // Token expired or unauthorized
        showToast('Session expired. Please sign in again.', 'error');
        await auth.signOut();
        throw new Error('Unauthorized');
    }

    if (!res.ok) {
        const error = await res.text();
        throw new Error(`HTTP ${res.status}: ${error}`);
    }
    return res.json();
}

// ============================================
// TOAST NOTIFICATIONS
// ============================================

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast`;

    const icons = {
        success: '✓',
        error: '✗',
        warning: '⚠',
        info: 'ℹ'
    };

    toast.innerHTML = `
        <span style="color: var(--${type === 'error' ? 'danger' : type})">${icons[type] || icons.info}</span>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ============================================
// ROUTING
// ============================================

function initRouter() {
    window.addEventListener('hashchange', handleRoute);
    handleRoute();
}

function handleRoute() {
    const hash = window.location.hash || '#/';
    const path = hash.replace('#', '') || '/';

    // Map paths to pages
    const routes = {
        '/': 'dashboard',
        '/dashboard': 'dashboard',
        '/sources': 'sources',
        '/images': 'images',
        '/settings': 'settings',
    };

    const page = routes[path] || 'dashboard';
    navigateTo(page);
}

function navigateTo(page) {
    state.currentPage = page;

    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });

    // Render the page
    renderPage(page);
}

function renderPage(page) {
    const container = document.getElementById('pageContainer');

    switch (page) {
        case 'dashboard':
            renderDashboard(container);
            break;
        case 'sources':
            renderSourcesPage(container);
            break;
        case 'images':
            renderImagesPage(container);
            break;
        case 'settings':
            renderSettingsPage(container);
            break;
        default:
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🤷</div><div class="empty-state-title">Page Not Found</div></div>';
    }
}

// ============================================
// DASHBOARD PAGE
// ============================================

async function renderDashboard(container) {
    container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">Dashboard</h1>
            <div class="page-actions">
                <button class="btn btn-primary" id="runNowBtn" onclick="runScrapeJob()">
                    ▶ Run Now
                </button>
            </div>
        </div>

        <!-- Stats Cards -->
        <div class="stats-grid mb-6">
            <div class="stat-card">
                <div class="stat-value" id="statScraped">-</div>
                <div class="stat-label">Scraped Today</div>
            </div>
            <div class="stat-card">
                <div class="stat-value success" id="statUploaded">-</div>
                <div class="stat-label">Uploaded</div>
            </div>
            <div class="stat-card">
                <div class="stat-value warning" id="statFiltered">-</div>
                <div class="stat-label">Filtered</div>
            </div>
            <div class="stat-card">
                <div class="stat-value danger" id="statFailed">-</div>
                <div class="stat-label">Failed</div>
            </div>
        </div>

        <div class="flex gap-6" style="flex-wrap: wrap;">
            <!-- Stats Chart -->
            <div class="card" style="flex: 2; min-width: 400px;">
                <div class="card-header">
                    <span class="card-title">📈 Weekly Trends</span>
                </div>
                <div class="card-body">
                    <canvas id="statsChart" height="200"></canvas>
                </div>
            </div>

            <!-- Live Progress / Status -->
            <div class="card" style="flex: 1; min-width: 280px;">
                <div class="card-header">
                    <span class="card-title">🔄 Job Status</span>
                </div>
                <div class="card-body" id="jobStatusContainer">
                    <div class="flex items-center gap-2 mb-4">
                        <span class="status-dot" id="dashStatusDot"></span>
                        <span id="dashStatusText">Loading...</span>
                    </div>
                    <div id="jobProgressSection" class="hidden">
                        <div class="text-sm text-muted mb-2">Progress</div>
                        <div class="progress-bar mb-2">
                            <div class="progress-fill" id="jobProgressFill" style="width: 0%"></div>
                        </div>
                        <div class="text-xs text-muted" id="jobProgressText">0 / 0 images</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Recent Activity -->
        <div class="card mt-6">
            <div class="card-header">
                <span class="card-title">📋 Recent Activity</span>
                <a href="#/images" class="btn btn-ghost btn-sm">View All Images →</a>
            </div>
            <div class="card-body">
                <div class="activity-list" id="activityList">
                    <div class="text-muted text-center">Loading activity...</div>
                </div>
            </div>
        </div>
    `;

    // Load dashboard data
    await Promise.all([
        loadStats(),
        loadStatsHistory(),
        loadJobHistory(),
    ]);

    updateDashboardStatus();
}

async function loadStats() {
    try {
        const stats = await api('/api/jobs/stats');
        state.stats = stats;

        document.getElementById('statScraped').textContent = stats.imagesScraped || 0;
        document.getElementById('statUploaded').textContent = stats.imagesUploaded || 0;
        document.getElementById('statFiltered').textContent = stats.qualityFiltered || 0;
        document.getElementById('statFailed').textContent = stats.imagesFailed || 0;
    } catch (e) {
        console.error('Failed to load stats:', e);
    }
}

async function loadStatsHistory() {
    try {
        const history = await api('/api/jobs/stats/history?days=7');
        state.statsHistory = history;
        renderStatsChart();
    } catch (e) {
        console.error('Failed to load stats history:', e);
        // Render empty chart
        renderStatsChart();
    }
}

function renderStatsChart() {
    const ctx = document.getElementById('statsChart');
    if (!ctx) return;

    const history = state.statsHistory || [];
    const labels = history.map(d => {
        const date = new Date(d.date);
        return date.toLocaleDateString('en-US', { weekday: 'short' });
    });

    // Destroy existing chart if any
    if (window.statsChartInstance) {
        window.statsChartInstance.destroy();
    }

    window.statsChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels.length ? labels : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [
                {
                    label: 'Uploaded',
                    data: history.map(d => d.imagesUploaded || 0),
                    backgroundColor: 'rgba(34, 197, 94, 0.8)',
                    borderRadius: 4,
                },
                {
                    label: 'Filtered',
                    data: history.map(d => d.qualityFiltered || 0),
                    backgroundColor: 'rgba(245, 158, 11, 0.8)',
                    borderRadius: 4,
                },
                {
                    label: 'Failed',
                    data: history.map(d => d.imagesFailed || 0),
                    backgroundColor: 'rgba(239, 68, 68, 0.8)',
                    borderRadius: 4,
                },
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#a1a1aa', boxWidth: 12 }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    grid: { display: false },
                    ticks: { color: '#71717a' }
                },
                y: {
                    stacked: true,
                    grid: { color: '#27272a' },
                    ticks: { color: '#71717a' }
                }
            }
        }
    });
}

async function loadJobHistory() {
    try {
        const history = await api('/api/jobs/history?limit=10');
        state.jobHistory = history;
        renderActivityList();
    } catch (e) {
        console.error('Failed to load job history:', e);
        renderActivityList();
    }
}

function renderActivityList() {
    const container = document.getElementById('activityList');
    if (!container) return;

    const history = state.jobHistory || [];

    if (history.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="padding: 24px;">
                <div class="empty-state-icon">📭</div>
                <div class="empty-state-title">No recent activity</div>
                <div class="empty-state-description">Run a scrape job to see activity here</div>
            </div>
        `;
        return;
    }

    container.innerHTML = history.map(job => {
        const date = new Date(job.startedAt);
        const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        const isSuccess = job.status === 'completed';
        const isFailed = job.status === 'failed';

        return `
            <div class="activity-item">
                <div class="activity-icon ${isSuccess ? 'success' : isFailed ? 'danger' : 'info'}">
                    ${isSuccess ? '✓' : isFailed ? '✗' : '⏳'}
                </div>
                <div class="activity-content">
                    <div class="activity-title">
                        ${isSuccess ? `Scraped ${job.imagesUploaded || 0} images` :
                isFailed ? `Job failed: ${job.errorMessage || 'Unknown error'}` :
                    'Job in progress...'}
                    </div>
                    <div class="activity-time">${dateStr} at ${timeStr}</div>
                </div>
            </div>
        `;
    }).join('');
}

async function updateDashboardStatus() {
    try {
        const status = await api('/api/jobs/status');
        const enabled = status.enabled;

        // Update sidebar status
        const sidebarDot = document.getElementById('sidebarStatusDot');
        const sidebarText = document.getElementById('sidebarStatusText');
        if (sidebarDot && sidebarText) {
            sidebarDot.className = `status-dot ${enabled ? 'online' : 'offline'}`;
            sidebarText.textContent = enabled ? 'Scheduler Active' : 'Scheduler Disabled';
        }

        // Update dashboard status
        const dashDot = document.getElementById('dashStatusDot');
        const dashText = document.getElementById('dashStatusText');
        if (dashDot && dashText) {
            dashDot.className = `status-dot ${enabled ? 'online' : 'offline'}`;

            if (status.lastRunAt) {
                const lastRun = new Date(status.lastRunAt);
                const nextRun = status.nextRunAt ? new Date(status.nextRunAt) : null;

                if (enabled && nextRun) {
                    const hoursUntil = Math.round((nextRun - new Date()) / (1000 * 60 * 60) * 10) / 10;
                    dashText.textContent = hoursUntil > 0
                        ? `Next run in ${hoursUntil}h`
                        : 'Running soon...';
                } else if (!enabled) {
                    dashText.textContent = 'Scheduler Disabled';
                } else {
                    dashText.textContent = `Last: ${lastRun.toLocaleTimeString()}`;
                }
            } else {
                dashText.textContent = enabled ? 'Waiting for first run' : 'Scheduler Disabled';
            }
        }
    } catch (e) {
        console.error('Failed to update status:', e);
    }
}

async function runScrapeJob() {
    const btn = document.getElementById('runNowBtn');
    if (!btn) return;

    try {
        btn.textContent = '⏳ Starting...';
        btn.disabled = true;

        await api('/api/jobs/run', { method: 'POST' });

        btn.textContent = '✓ Started!';
        showToast('Scrape job started successfully', 'success');

        setTimeout(() => {
            btn.textContent = '▶ Run Now';
            btn.disabled = false;
            loadStats();
            loadJobHistory();
        }, 2000);
    } catch (e) {
        console.error('Failed to start job:', e);
        btn.textContent = '✗ Failed';
        showToast('Failed to start scrape job', 'error');

        setTimeout(() => {
            btn.textContent = '▶ Run Now';
            btn.disabled = false;
        }, 2000);
    }
}

// ============================================
// SOURCES PAGE
// ============================================

async function renderSourcesPage(container) {
    container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">Sources</h1>
            <div class="page-actions">
                <button class="btn btn-secondary" onclick="openAddSourceModal()">
                    + Add Source
                </button>
            </div>
        </div>

        <!-- Bulk Actions -->
        <div class="card mb-4" id="bulkActionsCard" style="display: none;">
            <div class="card-body flex items-center gap-4">
                <span class="text-sm"><span id="selectedCount">0</span> selected</span>
                <button class="btn btn-sm btn-secondary" onclick="bulkToggleSources(true)">Enable</button>
                <button class="btn btn-sm btn-secondary" onclick="bulkToggleSources(false)">Disable</button>
                <button class="btn btn-sm btn-danger" onclick="bulkDeleteSources()">Delete</button>
                <button class="btn btn-sm btn-ghost" onclick="clearSourceSelection()">Clear</button>
            </div>
        </div>

        <!-- Sources List -->
        <div class="card">
            <div class="card-body" id="sourcesListContainer">
                <div class="text-muted text-center">Loading sources...</div>
            </div>
        </div>
    `;

    await loadSources();
}

async function loadSources() {
    try {
        state.sources = await api('/api/sources');
        renderSourcesList();
    } catch (e) {
        console.error('Failed to load sources:', e);
        const container = document.getElementById('sourcesListContainer');
        if (container) {
            container.innerHTML = `
                <div class="alert alert-danger">
                    Failed to load sources. Please try again.
                </div>
            `;
        }
    }
}

function renderSourcesList() {
    const container = document.getElementById('sourcesListContainer');
    if (!container) return;

    if (state.sources.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🔗</div>
                <div class="empty-state-title">No sources configured</div>
                <div class="empty-state-description">Add your first source to start scraping images</div>
                <button class="btn btn-primary" onclick="openAddSourceModal()">+ Add Source</button>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="flex flex-col gap-3">
            ${state.sources.map(source => renderSourceCard(source)).join('')}
        </div>
    `;
}

function renderSourceCard(source) {
    const isSelected = state.selectedSources.has(source.id);
    const lastRun = source.lastScrapedAt ? new Date(source.lastScrapedAt) : null;
    const lastRunStr = lastRun ? getRelativeTime(lastRun) : 'Never';

    // Calculate health based on recent success (simplified for now)
    const health = source.enabled ? 'healthy' : 'offline';

    return `
        <div class="source-card ${isSelected ? 'selected' : ''}" data-source-id="${source.id}">
            <div class="source-checkbox ${isSelected ? 'checked' : ''}" 
                 onclick="toggleSourceSelection('${source.id}', event)"></div>
            
            <div class="source-info">
                <div class="source-header">
                    <span class="badge badge-${source.type}">${source.type}</span>
                    <span class="source-query">${escapeHtml(source.query)}</span>
                    ${source.enabled ?
            `<span class="health-dot ${health}" title="${health}"></span>` :
            `<span class="badge badge-warning">Disabled</span>`
        }
                </div>
                <div class="source-meta">
                    Last run: ${lastRunStr} • ${source.totalScraped || 0} images total
                </div>
            </div>
            
            <div class="source-actions">
                <div class="toggle ${source.enabled ? 'active' : ''}" 
                     onclick="toggleSource('${source.id}', ${!source.enabled})"></div>
                <button class="btn btn-sm btn-secondary" onclick="editSource('${source.id}')">Edit</button>
                <button class="btn btn-sm btn-ghost" onclick="deleteSource('${source.id}')">🗑️</button>
            </div>
        </div>
    `;
}

function toggleSourceSelection(id, event) {
    event.stopPropagation();

    if (state.selectedSources.has(id)) {
        state.selectedSources.delete(id);
    } else {
        state.selectedSources.add(id);
    }

    updateBulkActionsUI();
    renderSourcesList();
}

function clearSourceSelection() {
    state.selectedSources.clear();
    updateBulkActionsUI();
    renderSourcesList();
}

function updateBulkActionsUI() {
    const card = document.getElementById('bulkActionsCard');
    const count = document.getElementById('selectedCount');

    if (card && count) {
        card.style.display = state.selectedSources.size > 0 ? 'block' : 'none';
        count.textContent = state.selectedSources.size;
    }
}

async function toggleSource(id, enabled) {
    try {
        await api(`/api/sources/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ enabled }),
        });
        await loadSources();
        showToast(`Source ${enabled ? 'enabled' : 'disabled'}`, 'success');
    } catch (e) {
        console.error('Failed to toggle source:', e);
        showToast('Failed to update source', 'error');
    }
}

async function bulkToggleSources(enabled) {
    try {
        const ids = Array.from(state.selectedSources);
        await api('/api/sources/bulk', {
            method: 'PUT',
            body: JSON.stringify({ ids, enabled }),
        });
        clearSourceSelection();
        await loadSources();
        showToast(`${ids.length} sources ${enabled ? 'enabled' : 'disabled'}`, 'success');
    } catch (e) {
        console.error('Failed to bulk toggle:', e);
        showToast('Failed to update sources', 'error');
    }
}

async function bulkDeleteSources() {
    if (!confirm(`Delete ${state.selectedSources.size} sources? This cannot be undone.`)) {
        return;
    }

    try {
        const ids = Array.from(state.selectedSources);
        await api('/api/sources/bulk', {
            method: 'DELETE',
            body: JSON.stringify({ ids }),
        });
        clearSourceSelection();
        await loadSources();
        showToast(`${ids.length} sources deleted`, 'success');
    } catch (e) {
        console.error('Failed to bulk delete:', e);
        showToast('Failed to delete sources', 'error');
    }
}

// Source Modal Functions
function openAddSourceModal() {
    state.editingSourceId = null;
    document.getElementById('sourceModalTitle').textContent = 'Add Source';
    document.getElementById('sourceType').value = 'unsplash';
    document.getElementById('sourceQuery').value = '';
    updateSourceQueryLabel();
    document.getElementById('sourceModal').classList.add('visible');
}

function editSource(id) {
    const source = state.sources.find(s => s.id === id);
    if (!source) return;

    state.editingSourceId = id;
    document.getElementById('sourceModalTitle').textContent = 'Edit Source';
    document.getElementById('sourceType').value = source.type;
    document.getElementById('sourceQuery').value = source.query;
    updateSourceQueryLabel();
    document.getElementById('sourceModal').classList.add('visible');
}

function closeSourceModal() {
    document.getElementById('sourceModal').classList.remove('visible');
    state.editingSourceId = null;
}

function updateSourceQueryLabel() {
    const type = document.getElementById('sourceType').value;
    const label = document.getElementById('sourceQueryLabel');
    const input = document.getElementById('sourceQuery');

    switch (type) {
        case 'unsplash':
            label.textContent = 'Search Query';
            input.placeholder = 'e.g., interior design';
            break;
        case 'reddit':
            label.textContent = 'Subreddit Name';
            input.placeholder = 'e.g., RoomPorn';
            break;
        case 'url':
            label.textContent = 'Website URL';
            input.placeholder = 'e.g., https://example.com';
            break;
    }
}

async function saveSource() {
    const type = document.getElementById('sourceType').value;
    const query = document.getElementById('sourceQuery').value.trim();

    if (!query) {
        showToast('Please enter a query', 'warning');
        return;
    }

    try {
        if (state.editingSourceId) {
            await api(`/api/sources/${state.editingSourceId}`, {
                method: 'PUT',
                body: JSON.stringify({ type, query }),
            });
            showToast('Source updated', 'success');
        } else {
            await api('/api/sources', {
                method: 'POST',
                body: JSON.stringify({ type, query }),
            });
            showToast('Source added', 'success');
        }

        closeSourceModal();
        await loadSources();
    } catch (e) {
        console.error('Failed to save source:', e);
        showToast('Failed to save source', 'error');
    }
}

function deleteSource(id) {
    state.pendingDeleteId = id;
    document.getElementById('confirmModal').classList.add('visible');
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('visible');
    state.pendingDeleteId = null;
}

async function confirmDelete() {
    if (!state.pendingDeleteId) return;

    try {
        await api(`/api/sources/${state.pendingDeleteId}`, { method: 'DELETE' });
        showToast('Source deleted', 'success');
        await loadSources();
    } catch (e) {
        console.error('Failed to delete source:', e);
        showToast('Failed to delete source', 'error');
    }

    closeConfirmModal();
}

// ============================================
// IMAGES PAGE
// ============================================

async function renderImagesPage(container) {
    container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">Images</h1>
        </div>

        <!-- Tabs -->
        <div class="tabs mb-6">
            <button class="tab ${state.imagesTab === 'recent' ? 'active' : ''}" 
                    onclick="switchImagesTab('recent')">Recent</button>
            <button class="tab ${state.imagesTab === 'failed' ? 'active' : ''}" 
                    onclick="switchImagesTab('failed')">Failed</button>
            <button class="tab ${state.imagesTab === 'filtered' ? 'active' : ''}" 
                    onclick="switchImagesTab('filtered')">Filtered</button>
        </div>

        <!-- Images Grid -->
        <div id="imagesContent">
            <div class="text-muted text-center">Loading images...</div>
        </div>
    `;

    await loadImagesForTab(state.imagesTab);
}

async function switchImagesTab(tab) {
    state.imagesTab = tab;

    // Update tab UI
    document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('active', t.textContent.toLowerCase() === tab);
    });

    await loadImagesForTab(tab);
}

async function loadImagesForTab(tab) {
    const container = document.getElementById('imagesContent');
    if (!container) return;

    container.innerHTML = `
        <div class="flex justify-center items-center gap-2" style="padding: 48px;">
            <div class="spinner"></div>
            <span class="text-muted">Loading images...</span>
        </div>
    `;

    try {
        let images = [];
        let emptyMessage = '';

        switch (tab) {
            case 'recent':
                images = await api('/api/images/recent?limit=50');
                state.recentImages = images;
                emptyMessage = 'No images have been scraped yet';
                break;
            case 'failed':
                images = await api('/api/images/failed?limit=50');
                state.failedImages = images;
                emptyMessage = 'No failed images to show';
                break;
            case 'filtered':
                images = await api('/api/images/filtered?limit=50');
                state.filteredImages = images;
                emptyMessage = 'No filtered images to show';
                break;
        }

        renderImagesGrid(container, images, tab, emptyMessage);
    } catch (e) {
        console.error('Failed to load images:', e);
        container.innerHTML = `
            <div class="alert alert-danger">
                Failed to load images. The API endpoint may not be available yet.
            </div>
        `;
    }
}

function renderImagesGrid(container, images, tab, emptyMessage) {
    if (!images || images.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">${tab === 'failed' ? '✓' : '🖼️'}</div>
                <div class="empty-state-title">${emptyMessage}</div>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="image-grid">
            ${images.map((img, idx) => renderImageCard(img, tab, idx)).join('')}
        </div>
    `;
}

function renderImageCard(image, tab, index) {
    const imageUrl = image.imageUrl || image.url || '';
    const badgeHtml = tab === 'failed'
        ? `<span class="badge badge-danger">Failed</span>`
        : tab === 'filtered'
            ? `<span class="badge badge-warning">${Math.round((image.qualityScore || 0) * 100)}%</span>`
            : '';

    return `
        <div class="image-card" onclick="openImageModal(${index}, '${tab}')">
            <img src="${escapeHtml(imageUrl)}" alt="Scraped image" 
                 onerror="this.style.display='none'" loading="lazy">
            <div class="image-card-overlay"></div>
            ${badgeHtml ? `<div class="image-card-badge">${badgeHtml}</div>` : ''}
            <div class="image-card-info">
                <div class="truncate">${escapeHtml(image.sourceDomain || 'Unknown source')}</div>
            </div>
        </div>
    `;
}

function openImageModal(index, tab) {
    let images = [];
    switch (tab) {
        case 'recent': images = state.recentImages; break;
        case 'failed': images = state.failedImages; break;
        case 'filtered': images = state.filteredImages; break;
    }

    const image = images[index];
    if (!image) return;

    const modal = document.getElementById('imageModal');
    const body = document.getElementById('imageModalBody');
    const footer = document.getElementById('imageModalFooter');

    const imageUrl = image.imageUrl || image.url || '';

    body.innerHTML = `
        <div class="flex gap-6" style="flex-wrap: wrap;">
            <div style="flex: 1; min-width: 200px;">
                <img src="${escapeHtml(imageUrl)}" alt="Image preview" 
                     style="width: 100%; border-radius: 8px; max-height: 400px; object-fit: contain;">
            </div>
            <div style="flex: 1; min-width: 200px;">
                <h4 class="mb-4">Details</h4>
                <div class="flex flex-col gap-3">
                    <div>
                        <div class="text-xs text-muted">Source</div>
                        <div class="text-sm">${escapeHtml(image.sourceDomain || 'Unknown')}</div>
                    </div>
                    ${image.qualityScore !== undefined ? `
                    <div>
                        <div class="text-xs text-muted">Quality Score</div>
                        <div class="text-sm">${Math.round(image.qualityScore * 100)}%</div>
                    </div>
                    ` : ''}
                    ${image.qualityType ? `
                    <div>
                        <div class="text-xs text-muted">Type</div>
                        <div class="text-sm">${escapeHtml(image.qualityType)}</div>
                    </div>
                    ` : ''}
                    ${image.filterReason || image.lastFailReason ? `
                    <div>
                        <div class="text-xs text-muted">Reason</div>
                        <div class="text-sm">${escapeHtml(image.filterReason || image.lastFailReason)}</div>
                    </div>
                    ` : ''}
                    ${image.failCount ? `
                    <div>
                        <div class="text-xs text-muted">Fail Count</div>
                        <div class="text-sm">${image.failCount} attempts</div>
                    </div>
                    ` : ''}
                    <div>
                        <div class="text-xs text-muted">URL</div>
                        <div class="text-sm truncate">
                            <a href="${escapeHtml(imageUrl)}" target="_blank">${escapeHtml(imageUrl)}</a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Show retry button for failed images
    if (tab === 'failed' && image.id) {
        footer.innerHTML = `
            <button class="btn btn-secondary" onclick="skipFailedImage(${image.id})">Skip Permanently</button>
            <button class="btn btn-primary" onclick="retryFailedImage(${image.id})">Retry</button>
            <button class="btn btn-ghost" onclick="closeImageModal()">Close</button>
        `;
    } else {
        footer.innerHTML = `<button class="btn btn-secondary" onclick="closeImageModal()">Close</button>`;
    }

    modal.classList.add('visible');
}

function closeImageModal() {
    document.getElementById('imageModal').classList.remove('visible');
}

async function retryFailedImage(id) {
    try {
        await api(`/api/images/${id}/retry`, { method: 'POST' });
        showToast('Image queued for retry', 'success');
        closeImageModal();
        await loadImagesForTab('failed');
    } catch (e) {
        console.error('Failed to retry image:', e);
        showToast('Failed to retry image', 'error');
    }
}

async function skipFailedImage(id) {
    try {
        await api(`/api/images/${id}/skip`, { method: 'DELETE' });
        showToast('Image skipped permanently', 'success');
        closeImageModal();
        await loadImagesForTab('failed');
    } catch (e) {
        console.error('Failed to skip image:', e);
        showToast('Failed to skip image', 'error');
    }
}

// ============================================
// SETTINGS PAGE
// ============================================

async function renderSettingsPage(container) {
    container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">Settings</h1>
        </div>

        <div class="flex flex-col gap-6">
            <!-- Schedule Settings -->
            <div class="card">
                <div class="card-header">
                    <span class="card-title">📅 Schedule</span>
                </div>
                <div class="card-body">
                    <div class="flex gap-6" style="flex-wrap: wrap;">
                        <div class="form-group" style="flex: 1; min-width: 150px;">
                            <label class="form-label">Batch Size</label>
                            <input type="number" class="form-input" id="settingsBatchSize" 
                                   min="1" max="100" value="30" style="width: 100%;">
                            <div class="text-xs text-muted mt-1">Images per run</div>
                        </div>
                        <div class="form-group" style="flex: 1; min-width: 150px;">
                            <label class="form-label">Interval (hours)</label>
                            <input type="number" class="form-input" id="settingsIntervalHours" 
                                   min="1" max="24" value="4" style="width: 100%;">
                            <div class="text-xs text-muted mt-1">Time between runs</div>
                        </div>
                        <div class="form-group" style="flex: 1; min-width: 150px;">
                            <label class="form-label">Scheduler Enabled</label>
                            <div class="toggle" id="settingsEnabledToggle" onclick="toggleSchedulerEnabled()"></div>
                        </div>
                    </div>
                </div>
                <div class="card-footer">
                    <button class="btn btn-primary" onclick="saveScheduleSettings()">Save Schedule</button>
                </div>
            </div>

            <!-- Quality Filter Settings -->
            <div class="card">
                <div class="card-header">
                    <span class="card-title">🎯 Quality Filter</span>
                </div>
                <div class="card-body">
                    <div class="form-group mb-4">
                        <label class="form-label">Minimum Quality Score</label>
                        <div class="flex items-center gap-4">
                            <input type="range" id="qualityMinScore" min="0" max="100" value="60" 
                                   style="flex: 1;" oninput="updateQualityScoreDisplay()">
                            <span id="qualityMinScoreDisplay" class="text-sm font-medium" style="min-width: 40px;">60%</span>
                        </div>
                        <div class="text-xs text-muted mt-1">Images below this score will be filtered out</div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Allowed Image Types</label>
                        <div class="flex gap-4" style="flex-wrap: wrap;">
                            <label class="flex items-center gap-2">
                                <input type="checkbox" id="typePhoto" checked> Photography
                            </label>
                            <label class="flex items-center gap-2">
                                <input type="checkbox" id="typeArt" checked> Art
                            </label>
                            <label class="flex items-center gap-2">
                                <input type="checkbox" id="typeDesign" checked> Design
                            </label>
                            <label class="flex items-center gap-2">
                                <input type="checkbox" id="typeProduct"> Product
                            </label>
                        </div>
                    </div>
                </div>
                <div class="card-footer">
                    <button class="btn btn-primary" onclick="saveQualitySettings()">Save Quality Settings</button>
                </div>
            </div>

            <!-- Data Management -->
            <div class="card">
                <div class="card-header">
                    <span class="card-title">💾 Data Management</span>
                </div>
                <div class="card-body">
                    <div class="flex gap-4" style="flex-wrap: wrap;">
                        <button class="btn btn-secondary" onclick="exportSettings()">
                            📤 Export Settings
                        </button>
                        <button class="btn btn-secondary" onclick="importSettings()">
                            📥 Import Settings
                        </button>
                        <button class="btn btn-danger" onclick="clearFailedCache()">
                            🗑️ Clear Failed Images Cache
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    await loadSettingsData();
}

async function loadSettingsData() {
    try {
        // Load schedule settings
        const schedule = await api('/api/sources/settings/schedule');
        state.settings = schedule;

        document.getElementById('settingsBatchSize').value = schedule.batchSize || 30;
        document.getElementById('settingsIntervalHours').value = schedule.intervalHours || 4;
        document.getElementById('settingsEnabledToggle').classList.toggle('active', schedule.enabled);

        // Load quality settings
        try {
            const quality = await api('/api/settings/quality');
            if (quality.minScore !== undefined) {
                document.getElementById('qualityMinScore').value = quality.minScore * 100;
                updateQualityScoreDisplay();
            }
            if (quality.allowedTypes) {
                document.getElementById('typePhoto').checked = quality.allowedTypes.includes('photography');
                document.getElementById('typeArt').checked = quality.allowedTypes.includes('art');
                document.getElementById('typeDesign').checked = quality.allowedTypes.includes('design');
                document.getElementById('typeProduct').checked = quality.allowedTypes.includes('product');
            }
        } catch (e) {
            // Quality settings API may not exist yet
            console.log('Quality settings not available yet');
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
        showToast('Failed to load settings', 'error');
    }
}

function toggleSchedulerEnabled() {
    const toggle = document.getElementById('settingsEnabledToggle');
    toggle.classList.toggle('active');
}

function updateQualityScoreDisplay() {
    const value = document.getElementById('qualityMinScore').value;
    document.getElementById('qualityMinScoreDisplay').textContent = `${value}%`;
}

async function saveScheduleSettings() {
    try {
        const settings = {
            batchSize: parseInt(document.getElementById('settingsBatchSize').value, 10),
            intervalHours: parseInt(document.getElementById('settingsIntervalHours').value, 10),
            enabled: document.getElementById('settingsEnabledToggle').classList.contains('active'),
        };

        await api('/api/sources/settings/schedule', {
            method: 'PUT',
            body: JSON.stringify(settings),
        });

        showToast('Schedule settings saved', 'success');
        updateDashboardStatus();
    } catch (e) {
        console.error('Failed to save settings:', e);
        showToast('Failed to save settings', 'error');
    }
}

async function saveQualitySettings() {
    try {
        const settings = {
            minScore: parseInt(document.getElementById('qualityMinScore').value, 10) / 100,
            allowedTypes: [
                document.getElementById('typePhoto').checked && 'photography',
                document.getElementById('typeArt').checked && 'art',
                document.getElementById('typeDesign').checked && 'design',
                document.getElementById('typeProduct').checked && 'product',
            ].filter(Boolean),
        };

        await api('/api/settings/quality', {
            method: 'PUT',
            body: JSON.stringify(settings),
        });

        showToast('Quality settings saved', 'success');
    } catch (e) {
        console.error('Failed to save quality settings:', e);
        showToast('Quality settings API not available yet', 'warning');
    }
}

async function exportSettings() {
    try {
        const data = await api('/api/settings/export');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ora-scraper-settings-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Settings exported', 'success');
    } catch (e) {
        console.error('Failed to export settings:', e);
        showToast('Export API not available yet', 'warning');
    }
}

function importSettings() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);

            await api('/api/settings/import', {
                method: 'POST',
                body: JSON.stringify(data),
            });

            showToast('Settings imported', 'success');
            await loadSettingsData();
        } catch (e) {
            console.error('Failed to import settings:', e);
            showToast('Failed to import settings', 'error');
        }
    };
    input.click();
}

async function clearFailedCache() {
    if (!confirm('Clear all failed images from the cache? They will be retried on the next scrape.')) {
        return;
    }

    try {
        await api('/api/images/failed/clear', { method: 'DELETE' });
        showToast('Failed images cache cleared', 'success');
    } catch (e) {
        console.error('Failed to clear cache:', e);
        showToast('Clear cache API not available yet', 'warning');
    }
}

// ============================================
// UTILITIES
// ============================================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getRelativeTime(date) {
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Firebase Auth
    initAuth();

    // Set up source type change listener
    document.getElementById('sourceType').addEventListener('change', updateSourceQueryLabel);

    // Start status polling (only when authenticated)
    setInterval(() => {
        if (currentUser && state.currentPage === 'dashboard') {
            updateDashboardStatus();
        }
    }, 30000);
});
