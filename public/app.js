/**
 * ORA Scraper Admin UI - Main Application
 * Multi-page SPA with Firebase Authentication
 */

// ============================================
// FIREBASE CONFIG & AUTH
// ============================================

// Firebase configuration - angles-423a4 project
const firebaseConfig = {
    apiKey: "AIzaSyCukE0XI_QKnVUd1PX3oqi5jQXs_gOzCfQ",
    authDomain: "angles-423a4.firebaseapp.com",
    projectId: "angles-423a4",
    storageBucket: "angles-423a4.firebasestorage.app",
    messagingSenderId: "1024758653829",
    appId: "1:1024758653829:web:4d5d71043ae4e752bedaec",
    measurementId: "G-1WCW1XFN35"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

// Initialize App Check with debug provider for admin dashboard
// This is an internal admin tool - using debug provider is acceptable
// The debug token will be printed in console, register it at:
// Firebase Console > App Check > Apps > Manage Debug Tokens
self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
const appCheck = firebase.appCheck();
appCheck.activate(
    new firebase.appCheck.ReCaptchaV3Provider('6LcxIFEsAAAAANSvcZkmgF24oZyvKOr1kmdInVKW'),
    true // isTokenAutoRefreshEnabled
);

// Auth state
let currentUser = null;
let authToken = null;

// ============================================
// STATE MANAGEMENT
// ============================================

const state = {
    // Data (Scraper)
    sources: [],
    settings: {},
    stats: {},
    statsHistory: [],
    recentImages: [],
    failedImages: [],
    filteredImages: [],
    jobHistory: [],
    currentJob: null,

    // Data (CMS)
    cmsPosts: [],
    cmsUsers: [],
    cmsBoards: [],
    cmsIdeas: [],
    cmsSuggestions: [],
    cmsAnalytics: null,
    cmsLastId: null,
    cmsHasMore: false,

    // UI State
    currentPage: 'dashboard',
    editingSourceId: null,
    pendingDeleteId: null,
    selectedSources: new Set(),
    imagesTab: 'recent',

    // CMS UI State
    postsViewMode: 'list', // 'list' or 'grid'
    selectedPosts: new Set(),
    cmsSearchQueries: {
        posts: '',
        users: '',
        boards: '',
    },
    cmsFilters: {
        status: '',
        moderationStatus: '',
    },

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

                // Allow any authenticated user for now
                if (result.authenticated) {
                    showApp();
                    document.getElementById('userEmail').textContent = user.email;
                    initRouter();
                    updateDashboardStatus();

                    // Refresh token periodically
                    setInterval(async () => {
                        authToken = await user.getIdToken(true);
                    }, 50 * 60 * 1000); // Refresh every 50 minutes
                } else {
                    showLoginError('Access denied. Authentication failed.');
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
        '/posts': 'posts',
        '/users': 'users',
        '/boards': 'boards',
        '/ideas': 'ideas',
        '/analytics': 'analytics',
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
        case 'posts':
            renderPostsPage(container);
            break;
        case 'users':
            renderUsersPage(container);
            break;
        case 'boards':
            renderBoardsPage(container);
            break;
        case 'ideas':
            renderIdeasPage(container);
            break;
        case 'analytics':
            renderAnalyticsPage(container);
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

        <!-- Stats Cards (Scraper) -->
        <div class="nav-section-title mb-2" style="padding-left: 0;">Scraper Status</div>
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

        <!-- Stats Cards (Platform CMS) -->
        <div class="nav-section-title mb-2" style="padding-left: 0;">Platform Overview</div>
        <div id="platformOverviewGrid" class="stats-grid mb-6">
            <div class="stat-card">
                <div class="stat-value" id="statUsers">-</div>
                <div class="stat-label">Total Users</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="statPosts">-</div>
                <div class="stat-label">Total Posts</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="statIdeas">-</div>
                <div class="stat-label">Active Ideas</div>
            </div>
            <div class="stat-card">
                <div class="stat-value warning" id="statAwaitingMod">-</div>
                <div class="stat-label">Awaiting Mod</div>
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
        // Scraper stats
        const stats = await api('/api/jobs/stats');
        state.stats = stats;

        document.getElementById('statScraped').textContent = stats.imagesScraped || 0;
        document.getElementById('statUploaded').textContent = stats.imagesUploaded || 0;
        document.getElementById('statFiltered').textContent = stats.qualityFiltered || 0;
        document.getElementById('statFailed').textContent = stats.imagesFailed || 0;

        // Platform CMS stats
        const cmsOverview = await api('/api/cms/analytics/overview');
        document.getElementById('statUsers').textContent = cmsOverview.totals.users.toLocaleString();
        document.getElementById('statPosts').textContent = cmsOverview.totals.posts.toLocaleString();
        document.getElementById('statIdeas').textContent = cmsOverview.totals.ideas.toLocaleString();
        document.getElementById('statAwaitingMod').textContent = cmsOverview.moderation.awaitingModeration.toLocaleString();

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
    document.getElementById('crawlDepth').value = 0;
    document.getElementById('followLinks').checked = false;
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
    document.getElementById('crawlDepth').value = source.crawlDepth || 0;
    document.getElementById('followLinks').checked = !!source.followLinks;
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

    // Toggle crawl options for URL type
    const crawlOptions = document.getElementById('crawlOptions');
    if (crawlOptions) {
        crawlOptions.style.display = type === 'url' ? 'block' : 'none';
    }
}

async function saveSource() {
    const type = document.getElementById('sourceType').value;
    const query = document.getElementById('sourceQuery').value.trim();
    const crawlDepth = parseInt(document.getElementById('crawlDepth').value, 10) || 0;
    const followLinks = document.getElementById('followLinks').checked;

    if (!query) {
        showToast('Please enter a query', 'warning');
        return;
    }

    try {
        const body = { type, query };
        if (type === 'url') {
            body.crawlDepth = crawlDepth;
            body.followLinks = followLinks;
        }

        if (state.editingSourceId) {
            await api(`/api/sources/${state.editingSourceId}`, {
                method: 'PUT',
                body: JSON.stringify(body),
            });
            showToast('Source updated', 'success');
        } else {
            await api('/api/sources', {
                method: 'POST',
                body: JSON.stringify(body),
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
            <button class="btn btn-danger" onclick="deleteImage(${image.id}, '${tab}')">Delete</button>
            <button class="btn btn-ghost" onclick="closeImageModal()">Close</button>
        `;
    } else {
        footer.innerHTML = `
            <button class="btn btn-danger" onclick="deleteImage(${image.id}, '${tab}')" style="margin-right: auto;">Delete</button>
            <button class="btn btn-secondary" onclick="closeImageModal()">Close</button>
        `;
    }

    modal.classList.add('visible');
}

async function deleteImage(id, tab) {
    if (!confirm('Delete this image and its associated post? This action cannot be undone.')) {
        return;
    }

    try {
        await api(`/api/images/${id}`, { method: 'DELETE' });
        showToast('Image and post deleted', 'success');
        closeImageModal();
        await loadImagesForTab(tab);

        // Refresh dashboard if we're there
        if (state.currentPage === 'dashboard') {
            loadStats();
        }
    } catch (e) {
        console.error('Failed to delete image:', e);
        showToast('Failed to delete image', 'error');
    }
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
// CMS: POSTS PAGE
// ============================================

async function renderPostsPage(container) {
    container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">Posts Management</h1>
            <div class="page-actions">
                <div class="view-toggle mr-4">
                    <div class="view-toggle-btn ${state.postsViewMode === 'list' ? 'active' : ''}" onclick="togglePostsView('list')">List</div>
                    <div class="view-toggle-btn ${state.postsViewMode === 'grid' ? 'active' : ''}" onclick="togglePostsView('grid')">Grid</div>
                </div>
                <button class="btn btn-secondary" onclick="loadCmsPosts()">🔄 Refresh</button>
            </div>
        </div>

        <div class="card mb-6">
            <div class="card-body">
                <div class="cms-table-header">
                    <input type="text" class="form-input cms-search-input" id="postsSearch" 
                           placeholder="Search by author ID or description..." 
                           value="${state.cmsSearchQueries.posts}"
                           oninput="handlePostsSearch(event)">
                    
                    <select class="form-select" id="filterStatus" onchange="handlePostsFilterChange()">
                        <option value="">All Status</option>
                        <option value="pending">Pending</option>
                        <option value="completed">Completed</option>
                        <option value="failed">Failed</option>
                    </select>

                    <select class="form-select" id="filterModeration" onchange="handlePostsFilterChange()">
                        <option value="">Moderation: All</option>
                        <option value="pending">Awaiting</option>
                        <option value="approved">Approved</option>
                        <option value="flagged">Flagged</option>
                        <option value="rejected">Rejected</option>
                    </select>
                </div>

                <div id="postsContent">
                    <div class="text-center p-8 text-muted">Loading posts...</div>
                </div>

                <div id="postsLoadMore" class="mt-4 text-center hidden">
                    <button class="btn btn-secondary" onclick="loadCmsPosts(true)">Load More</button>
                </div>
            </div>
        </div>
    `;

    // Reset state for new page
    state.cmsLastId = null;
    clearSelection();
    await loadCmsPosts();
}

async function loadCmsPosts(append = false) {
    const content = document.getElementById('postsContent');
    const loadMoreBtn = document.getElementById('postsLoadMore');

    if (!append) {
        state.cmsLastId = null;
    }

    try {
        const params = new URLSearchParams({
            limit: 20,
            status: state.cmsFilters.status,
            moderationStatus: state.cmsFilters.moderationStatus,
            search: state.cmsSearchQueries.posts,
        });

        if (state.cmsLastId) {
            params.append('startAfter', state.cmsLastId);
        }

        const data = await api(`/api/cms/posts?${params.toString()}`);
        state.cmsPosts = append ? [...state.cmsPosts, ...data.posts] : data.posts;
        state.cmsLastId = data.lastId;
        state.cmsHasMore = data.hasMore;

        renderPosts();

        if (loadMoreBtn) {
            loadMoreBtn.classList.toggle('hidden', !state.cmsHasMore);
        }
    } catch (e) {
        console.error('Failed to load posts:', e);
        if (content) content.innerHTML = '<div class="text-center p-8 text-danger">Failed to load posts</div>';
    }
}

function renderPostsTable() {
    const tableBody = document.getElementById('postsTableBody');
    if (!tableBody) return;

    if (state.cmsPosts.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No posts found</td></tr>';
        return;
    }

    tableBody.innerHTML = state.cmsPosts.map(post => {
        const thumbUrl = post.content?.thumbnailUrl || post.content?.url || post.content?.jpegUrl || '';
        const authorName = post.author?.username || post.author?.displayName || 'Unknown';
        const date = post.createdAt ? new Date(post.createdAt) : null;

        const statusClass =
            post.processingStatus === 'completed' ? 'badge-success' :
                post.processingStatus === 'failed' ? 'badge-danger' : 'badge-info';

        const modClass =
            post.moderationStatus === 'approved' ? 'badge-success' :
                post.moderationStatus === 'flagged' ? 'badge-warning' :
                    post.moderationStatus === 'rejected' ? 'badge-danger' : 'badge-info';

        return `
            <tr>
                <td>
                    <img src="${escapeHtml(thumbUrl)}" class="cms-thumb" onerror="this.src='https://placehold.co/40x40?text=?'">
                </td>
                <td>
                    <div class="flex items-center gap-2">
                        <img src="${post.author?.avatarUrl || 'https://placehold.co/32x32?text=U'}" class="cms-user-avatar">
                        <span class="text-xs">${escapeHtml(authorName)}</span>
                    </div>
                </td>
                <td>
                    <div class="text-xs truncate" style="max-width: 200px;" title="${escapeHtml(post.description || '')}">
                        ${escapeHtml(post.description || 'No description')}
                    </div>
                </td>
                <td><span class="badge ${statusClass}">${post.processingStatus || 'pending'}</span></td>
                <td><span class="badge ${modClass}">${post.moderationStatus || 'pending'}</span></td>
                <td class="text-xs text-muted">${date ? getRelativeTime(date) : 'Unknown'}</td>
                <td>
                    <div class="flex gap-2">
                        <button class="btn btn-sm btn-secondary" onclick="viewPostDetails('${post.id}')">View</button>
                        <button class="btn btn-sm btn-ghost" onclick="deleteCmsPost('${post.id}')">🗑️</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

let searchTimer;
function handlePostsSearch(event) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        state.cmsSearchQueries.posts = event.target.value;
        loadCmsPosts();
    }, 500);
}

function handlePostsFilterChange() {
    state.cmsFilters.status = document.getElementById('filterStatus').value;
    state.cmsFilters.moderationStatus = document.getElementById('filterModeration').value;
    loadCmsPosts();
}

async function viewPostDetails(id) {
    try {
        const post = await api(`/api/cms/posts/${id}`);
        const modal = document.getElementById('postModal');
        const body = document.getElementById('postModalBody');
        const footer = document.getElementById('postModalFooter');

        const imageUrl = post.content?.url || post.content?.jpegUrl || '';
        const authorName = post.author?.username || post.author?.displayName || 'Unknown';

        body.innerHTML = `
            <div class="flex gap-6" style="flex-wrap: wrap;">
                <div style="flex: 1; min-width: 300px;">
                    <img src="${escapeHtml(imageUrl)}" style="width: 100%; border-radius: var(--radius-lg); max-height: 500px; object-fit: contain;">
                </div>
                <div style="flex: 1; min-width: 250px;">
                    <div class="mb-4">
                        <h4 class="text-muted font-medium uppercase text-xs mb-2">Author</h4>
                        <div class="flex items-center gap-3">
                            <img src="${post.author?.avatarUrl || 'https://placehold.co/32x32?text=U'}" class="cms-user-avatar" style="width: 48px; height: 48px;">
                            <div>
                                <div class="font-semibold">${escapeHtml(authorName)}</div>
                                <div class="text-xs text-muted">${post.authorId}</div>
                            </div>
                        </div>
                    </div>
                    <div class="mb-4">
                        <h4 class="text-muted font-medium uppercase text-xs mb-2">Description</h4>
                        <p class="text-sm">${escapeHtml(post.description || 'No description')}</p>
                    </div>
                    <div class="mb-4">
                        <h4 class="text-muted font-medium uppercase text-xs mb-2">Stats</h4>
                        <div class="flex gap-4 text-sm">
                            <span>❤️ ${post.likeCount || 0}</span>
                            <span>🔖 ${post.saveCount || 0}</span>
                            <span>👁️ ${post.viewCount || 0}</span>
                        </div>
                    </div>
                    <div class="mb-4">
                        <h4 class="text-muted font-medium uppercase text-xs mb-2">Moderation Status</h4>
                        <select id="updateModStatus" class="form-select w-full">
                            <option value="pending" ${post.moderationStatus === 'pending' ? 'selected' : ''}>Awaiting</option>
                            <option value="approved" ${post.moderationStatus === 'approved' ? 'selected' : ''}>Approved</option>
                            <option value="flagged" ${post.moderationStatus === 'flagged' ? 'selected' : ''}>Flagged</option>
                            <option value="rejected" ${post.moderationStatus === 'rejected' ? 'selected' : ''}>Rejected</option>
                        </select>
                    </div>
                </div>
            </div>
        `;

        footer.innerHTML = `
            <button class="btn btn-secondary" onclick="closePostModal()">Cancel</button>
            <button class="btn btn-primary" onclick="updatePostStatus('${post.id}')">Save Changes</button>
        `;

        modal.classList.add('visible');
    } catch (e) {
        console.error('Failed to load post details:', e);
        showToast('Failed to load post details', 'error');
    }
}

function closePostModal() {
    document.getElementById('postModal').classList.remove('visible');
}

async function updatePostStatus(id) {
    const status = document.getElementById('updateModStatus').value;
    try {
        await api(`/api/cms/posts/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ moderationStatus: status }),
        });
        showToast('Post status updated', 'success');
        closePostModal();
        loadCmsPosts();
    } catch (e) {
        console.error('Failed to update post:', e);
        showToast('Failed to update post', 'error');
    }
}

function renderPosts() {
    const container = document.getElementById('postsContent');
    if (!container) return;

    if (state.postsViewMode === 'grid') {
        renderPostsGrid(container);
    } else {
        renderPostsTable(container);
    }

    updateBulkBar();
}

function renderPostsTable(container) {
    if (!state.cmsPosts || state.cmsPosts.length === 0) {
        container.innerHTML = '<div class="text-center p-8 text-muted">No posts found</div>';
        return;
    }

    container.innerHTML = `
        <div class="table-container">
            <table class="cms-table">
                <thead>
                    <tr>
                        <th style="width: 40px;"><input type="checkbox" class="post-checkbox" onchange="toggleSelectAll(event)"></th>
                        <th>Image</th>
                        <th>Author</th>
                        <th>Description</th>
                        <th>Status</th>
                        <th>Moderation</th>
                        <th>Created</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="postsTableBody">
                    ${state.cmsPosts.map(post => {
        const thumbUrl = post.content?.thumbnailUrl || post.content?.url || post.content?.jpegUrl || '';
        const authorName = post.author?.username || post.author?.displayName || 'Unknown';
        const date = post.createdAt ? new Date(post.createdAt) : null;
        const isSelected = state.selectedPosts.has(post.id);

        const statusClass =
            post.processingStatus === 'completed' ? 'badge-success' :
                post.processingStatus === 'failed' ? 'badge-danger' : 'badge-info';

        const modClass =
            post.moderationStatus === 'approved' ? 'badge-success' :
                post.moderationStatus === 'flagged' ? 'badge-warning' :
                    post.moderationStatus === 'rejected' ? 'badge-danger' : 'badge-info';

        return `
                            <tr>
                                <td><input type="checkbox" class="post-checkbox post-select" data-id="${post.id}" ${isSelected ? 'checked' : ''} onchange="togglePostSelection('${post.id}')"></td>
                                <td><img src="${escapeHtml(thumbUrl)}" class="cms-thumb" onerror="this.src='https://placehold.co/40x40?text=?'"></td>
                                <td>
                                    <div class="flex items-center gap-2">
                                        <img src="${post.author?.avatarUrl || 'https://placehold.co/32x32?text=U'}" class="cms-user-avatar">
                                        <span class="text-xs">${escapeHtml(authorName)}</span>
                                    </div>
                                </td>
                                <td><div class="text-xs truncate" style="max-width: 200px;" title="${escapeHtml(post.description || '')}">${escapeHtml(post.description || 'No description')}</div></td>
                                <td><span class="badge ${statusClass}">${post.processingStatus || 'pending'}</span></td>
                                <td><span class="badge ${modClass}">${post.moderationStatus || 'pending'}</span></td>
                                <td class="text-xs text-muted">${date ? getRelativeTime(date) : 'Unknown'}</td>
                                <td>
                                    <div class="flex gap-2">
                                        <button class="btn btn-sm btn-secondary" onclick="viewPostDetails('${post.id}')">View</button>
                                        <button class="btn btn-sm btn-ghost" onclick="deleteCmsPost('${post.id}')">🗑️</button>
                                    </div>
                                </td>
                            </tr>
                        `;
    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderPostsGrid(container) {
    if (!state.cmsPosts || state.cmsPosts.length === 0) {
        container.innerHTML = '<div class="text-center p-8 text-muted">No posts found</div>';
        return;
    }

    container.innerHTML = `
        <div class="posts-grid">
            ${state.cmsPosts.map(post => {
        const thumbUrl = post.content?.thumbnailUrl || post.content?.url || post.content?.jpegUrl || '';
        const authorName = post.author?.username || post.author?.displayName || 'Unknown';
        const isSelected = state.selectedPosts.has(post.id);

        const modClass =
            post.moderationStatus === 'approved' ? 'badge-success' :
                post.moderationStatus === 'flagged' ? 'badge-warning' :
                    post.moderationStatus === 'rejected' ? 'badge-danger' : 'badge-info';

        return `
                    <div class="post-grid-card ${isSelected ? 'selected' : ''}">
                        <div class="post-grid-selection">
                            <input type="checkbox" class="post-checkbox post-select" data-id="${post.id}" ${isSelected ? 'checked' : ''} onchange="togglePostSelection('${post.id}')">
                        </div>
                        <div class="post-grid-image-wrapper" onclick="viewPostDetails('${post.id}')">
                            <img src="${escapeHtml(thumbUrl)}" onerror="this.src='https://placehold.co/200x200?text=?'">
                        </div>
                        <div class="post-grid-info">
                            <div class="flex items-center gap-2 mb-1">
                                <img src="${post.author?.avatarUrl || 'https://placehold.co/20x20?text=U'}" class="cms-user-avatar" style="width:16px; height:16px;">
                                <span class="text-xs text-muted truncate">${escapeHtml(authorName)}</span>
                            </div>
                            <div class="text-xs truncate font-medium">${escapeHtml(post.description || 'No description')}</div>
                            <div class="post-grid-meta">
                                <span class="badge ${modClass}" style="font-size: 8px;">${post.moderationStatus || 'pending'}</span>
                                <span class="text-muted" style="font-size: 10px;">❤️ ${post.likeCount || 0}</span>
                            </div>
                        </div>
                    </div>
                `;
    }).join('')}
        </div>
    `;
}

function togglePostsView(view) {
    state.postsViewMode = view;
    renderPostsPage(document.getElementById('pageContainer'));
}

function togglePostSelection(id) {
    if (state.selectedPosts.has(id)) {
        state.selectedPosts.delete(id);
    } else {
        state.selectedPosts.add(id);
    }
    updateBulkBar();
}

function toggleSelectAll(event) {
    const checked = event.target.checked;
    if (checked) {
        state.cmsPosts.forEach(p => state.selectedPosts.add(p.id));
    } else {
        state.selectedPosts.clear();
    }
    renderPosts();
}

function clearSelection() {
    state.selectedPosts.clear();
    updateBulkBar();
    const selectAll = document.querySelector('.post-checkbox[onchange="toggleSelectAll(event)"]');
    if (selectAll) selectAll.checked = false;
    document.querySelectorAll('.post-select').forEach(cb => cb.checked = false);
}

function updateBulkBar() {
    const bar = document.getElementById('bulkActionsBar');
    const count = document.getElementById('bulkSelectedCount');
    if (!bar || !count) return;

    const size = state.selectedPosts.size;
    if (size > 0) {
        count.textContent = `${size} Selected`;
        bar.classList.add('visible');
    } else {
        bar.classList.remove('visible');
    }
}

async function handleBulkModerate(action) {
    const ids = Array.from(state.selectedPosts);
    if (!confirm(`Are you sure you want to ${action} ${ids.length} posts?`)) return;

    try {
        await api('/api/cms/posts/bulk/moderate', {
            method: 'POST',
            body: JSON.stringify({ ids, action }),
        });
        showToast(`Successfully ${action}d ${ids.length} posts`, 'success');
        clearSelection();
        loadCmsPosts();
    } catch (e) {
        console.error('Bulk moderation failed:', e);
        showToast('Bulk moderation failed', 'error');
    }
}

async function handleBulkDelete() {
    const ids = Array.from(state.selectedPosts);
    if (!confirm(`Are you sure you want to DELETE ${ids.length} posts? This cannot be undone!`)) return;

    try {
        await api('/api/cms/posts/bulk/delete', {
            method: 'POST',
            body: JSON.stringify({ ids }),
        });
        showToast(`Successfully deleted ${ids.length} posts`, 'success');
        clearSelection();
        loadCmsPosts();
    } catch (e) {
        console.error('Bulk delete failed:', e);
        showToast('Bulk delete failed', 'error');
    }
}

async function deleteCmsPost(id) {
    if (!confirm('Are you sure you want to delete this post? This cannot be undone.')) return;

    try {
        await api(`/api/cms/posts/${id}`, { method: 'DELETE' });
        showToast('Post deleted', 'success');
        loadCmsPosts();
    } catch (e) {
        console.error('Failed to delete post:', e);
        showToast('Failed to delete post', 'error');
    }
}

// ============================================
// CMS: USERS PAGE
// ============================================

async function renderUsersPage(container) {
    container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">Users Management</h1>
            <div class="page-actions">
                <button class="btn btn-secondary" onclick="loadCmsUsers()">🔄 Refresh</button>
            </div>
        </div>

        <div class="card mb-6">
            <div class="card-body">
                <div class="cms-table-header">
                    <input type="text" class="form-input cms-search-input" id="usersSearch" 
                           placeholder="Search by username or email..." 
                           value="${state.cmsSearchQueries.users}"
                           oninput="handleUsersSearch(event)">
                </div>

                <div class="table-container">
                    <table class="cms-table">
                        <thead>
                            <tr>
                                <th>User</th>
                                <th>Email</th>
                                <th>Joined</th>
                                <th>Banned</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody id="usersTableBody">
                            <tr><td colspan="5" class="text-center text-muted">Loading users...</td></tr>
                        </tbody>
                    </table>
                </div>

                <div id="usersLoadMore" class="mt-4 text-center hidden">
                    <button class="btn btn-secondary" onclick="loadCmsUsers(true)">Load More</button>
                </div>
            </div>
        </div>
    `;

    state.cmsLastId = null;
    await loadCmsUsers();
}

async function loadCmsUsers(append = false) {
    const tableBody = document.getElementById('usersTableBody');
    const loadMoreBtn = document.getElementById('usersLoadMore');

    if (!append) {
        state.cmsLastId = null;
        if (tableBody) tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Loading...</td></tr>';
    }

    try {
        const params = new URLSearchParams({
            limit: 20,
            search: state.cmsSearchQueries.users,
        });

        if (state.cmsLastId) {
            params.append('startAfter', state.cmsLastId);
        }

        const data = await api(`/api/cms/users?${params.toString()}`);
        state.cmsUsers = append ? [...state.cmsUsers, ...data.users] : data.users;
        state.cmsLastId = data.lastId;
        state.cmsHasMore = data.hasMore;

        renderUsersTable();

        if (loadMoreBtn) {
            loadMoreBtn.classList.toggle('hidden', !state.cmsHasMore);
        }
    } catch (e) {
        console.error('Failed to load users:', e);
        tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Failed to load users</td></tr>';
    }
}

function renderUsersTable() {
    const tableBody = document.getElementById('usersTableBody');
    if (!tableBody) return;

    if (state.cmsUsers.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No users found</td></tr>';
        return;
    }

    tableBody.innerHTML = state.cmsUsers.map(user => {
        const date = user.createdAt ? new Date(user.createdAt) : null;
        const banClass = user.banned ? 'badge-danger' : 'badge-success';

        return `
            <tr>
                <td>
                    <div class="flex items-center gap-2">
                        <img src="${user.avatarUrl || 'https://placehold.co/32x32?text=U'}" class="cms-user-avatar">
                        <div>
                            <div class="font-medium">${escapeHtml(user.username || 'No username')}</div>
                            <div class="text-xs text-muted">${user.id}</div>
                        </div>
                    </div>
                </td>
                <td>${escapeHtml(user.email || 'N/A')}</td>
                <td class="text-xs text-muted">${date ? getRelativeTime(date) : 'Unknown'}</td>
                <td><span class="badge ${banClass}">${user.banned ? 'Banned' : 'Active'}</span></td>
                <td>
                    <div class="flex gap-2">
                        <button class="btn btn-sm btn-secondary" onclick="viewUserDetails('${user.id}')">View</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

let usersSearchTimer;
function handleUsersSearch(event) {
    clearTimeout(usersSearchTimer);
    usersSearchTimer = setTimeout(() => {
        state.cmsSearchQueries.users = event.target.value;
        loadCmsUsers();
    }, 500);
}

async function viewUserDetails(id) {
    try {
        const user = await api(`/api/cms/users/${id}`);
        const modal = document.getElementById('userModal');
        const body = document.getElementById('userModalBody');
        const footer = document.getElementById('userModalFooter');

        body.innerHTML = `
            <div class="user-detail-header">
                <img src="${user.avatarUrl || 'https://placehold.co/80x80?text=U'}" class="user-detail-avatar">
                <div class="user-detail-info">
                    <h2>${escapeHtml(user.displayName || user.username || 'User')}</h2>
                    <p class="text-muted text-sm">@${escapeHtml(user.username || 'username')} • ${user.id}</p>
                    <div class="flex gap-4 mt-2">
                        <div class="stat-card p-2" style="min-width: 80px;">
                            <div class="stat-value text-md">${user.stats?.postCount || 0}</div>
                            <div class="stat-label" style="font-size: 8px;">Posts</div>
                        </div>
                        <div class="stat-card p-2" style="min-width: 80px;">
                            <div class="stat-value text-md">${user.stats?.boardCount || 0}</div>
                            <div class="stat-label" style="font-size: 8px;">Boards</div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="card mb-4">
                <div class="card-header"><span class="card-title">Account Details</span></div>
                <div class="card-body">
                    <div class="grid grid-cols-2 gap-4 text-sm">
                        <div>
                            <div class="text-muted text-xs">Email</div>
                            <div>${escapeHtml(user.email || 'N/A')}</div>
                        </div>
                        <div>
                            <div class="text-muted text-xs">Joined</div>
                            <div>${user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}</div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-header"><span class="card-title">Admin Actions</span></div>
                <div class="card-body">
                    <div class="form-group mb-4">
                        <label class="form-label">Ban Status</label>
                        <div class="flex items-center gap-4">
                            <span class="text-sm">${user.banned ? 'User is currently banned' : 'User is active'}</span>
                            <button class="btn btn-sm ${user.banned ? 'btn-success' : 'btn-danger'}" 
                                onclick="toggleUserBan('${user.id}', ${!user.banned})">
                                ${user.banned ? 'Unban User' : 'Ban User'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        footer.innerHTML = `
            <button class="btn btn-danger" onclick="deleteCmsUser('${user.id}')" style="margin-right: auto;">Delete Account</button>
            <button class="btn btn-secondary" onclick="closeUserModal()">Close</button>
        `;

        modal.classList.add('visible');
    } catch (e) {
        console.error('Failed to load user details:', e);
        showToast('Failed to load user details', 'error');
    }
}

function closeUserModal() {
    document.getElementById('userModal').classList.remove('visible');
}

async function toggleUserBan(id, banned) {
    if (!confirm(`Are you sure you want to ${banned ? 'ban' : 'unban'} this user?`)) return;

    try {
        await api(`/api/cms/users/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ banned }),
        });
        showToast(`User ${banned ? 'banned' : 'unbanned'}`, 'success');
        viewUserDetails(id);
        loadCmsUsers();
    } catch (e) {
        console.error('Failed to update user:', e);
        showToast('Failed to update user', 'error');
    }
}

async function deleteCmsUser(id) {
    if (!confirm('Are you sure you want to delete this user? This will delete all their content. This action is irreversible!')) return;

    try {
        await api(`/api/cms/users/${id}`, { method: 'DELETE' });
        showToast('User and content deleted', 'success');
        closeUserModal();
        loadCmsUsers();
    } catch (e) {
        console.error('Failed to delete user:', e);
        showToast('Failed to delete user', 'error');
    }
}

// ============================================
// CMS: BOARDS PAGE
// ============================================

async function renderBoardsPage(container) {
    container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">Boards Management</h1>
            <div class="page-actions">
                <button class="btn btn-secondary" onclick="loadCmsBoards()">🔄 Refresh</button>
            </div>
        </div>

        <div class="card mb-6">
            <div class="card-body">
                <div class="table-container">
                    <table class="cms-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Owner</th>
                                <th>Posts</th>
                                <th>Privacy</th>
                                <th>Created</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody id="boardsTableBody">
                            <tr><td colspan="6" class="text-center text-muted">Loading boards...</td></tr>
                        </tbody>
                    </table>
                </div>

                <div id="boardsLoadMore" class="mt-4 text-center hidden">
                    <button class="btn btn-secondary" onclick="loadCmsBoards(true)">Load More</button>
                </div>
            </div>
        </div>
    `;

    state.cmsLastId = null;
    await loadCmsBoards();
}

async function loadCmsBoards(append = false) {
    const tableBody = document.getElementById('boardsTableBody');
    const loadMoreBtn = document.getElementById('boardsLoadMore');

    if (!append) {
        state.cmsLastId = null;
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Loading...</td></tr>';
    }

    try {
        const params = new URLSearchParams({ limit: 20 });
        if (state.cmsLastId) {
            params.append('startAfter', state.cmsLastId);
        }

        const data = await api(`/api/cms/boards?${params.toString()}`);
        state.cmsBoards = append ? [...state.cmsBoards, ...data.boards] : data.boards;
        state.cmsLastId = data.lastId;
        state.cmsHasMore = data.hasMore;

        renderBoardsTable();

        if (loadMoreBtn) {
            loadMoreBtn.classList.toggle('hidden', !state.cmsHasMore);
        }
    } catch (e) {
        console.error('Failed to load boards:', e);
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Failed to load boards</td></tr>';
    }
}

function renderBoardsTable() {
    const tableBody = document.getElementById('boardsTableBody');
    if (!tableBody) return;

    if (state.cmsBoards.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No boards found</td></tr>';
        return;
    }

    tableBody.innerHTML = state.cmsBoards.map(board => {
        const ownerName = board.owner?.username || 'Unknown';
        const date = board.createdAt ? new Date(board.createdAt) : null;
        const privacyText = board.isPrivate ? 'Private' : 'Public';
        const privacyClass = board.isPrivate ? 'badge-warning' : 'badge-success';

        return `
            <tr>
                <td>
                    <div class="font-medium">${escapeHtml(board.name)}</div>
                    <div class="text-xs text-muted truncate" style="max-width: 200px;">${escapeHtml(board.description || '')}</div>
                </td>
                <td>
                    <div class="text-xs">${escapeHtml(ownerName)}</div>
                    <div class="text-xs text-muted" style="font-size: 10px;">${board.userId}</div>
                </td>
                <td><span class="font-medium">${board.postCount || 0}</span></td>
                <td><span class="badge ${privacyClass}">${privacyText}</span></td>
                <td class="text-xs text-muted">${date ? getRelativeTime(date) : 'Unknown'}</td>
                <td>
                    <div class="flex gap-2">
                        <button class="btn btn-sm btn-secondary" onclick="viewBoardDetails('${board.id}')">View</button>
                        <button class="btn btn-sm btn-ghost" onclick="deleteCmsBoard('${board.id}')">🗑️</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

async function viewBoardDetails(id) {
    try {
        const board = await api(`/api/cms/boards/${id}`);
        const modal = document.getElementById('boardModal');
        const body = document.getElementById('boardModalBody');

        body.innerHTML = `
            <div class="mb-6">
                <h2 class="text-xl font-bold mb-1">${escapeHtml(board.name)}</h2>
                <p class="text-muted text-sm">${escapeHtml(board.description || 'No description')}</p>
                <div class="flex gap-4 mt-3 text-xs">
                    <span>By: <b>${escapeHtml(board.owner?.username || 'Unknown')}</b></span>
                    <span>Posts: <b>${board.postCount || 0}</b></span>
                    <span>Status: <b>${board.isPrivate ? 'Private' : 'Public'}</b></span>
                </div>
            </div>

            <h4 class="text-muted font-medium uppercase text-xs mb-3">Preview Posts</h4>
            <div class="image-grid">
                ${board.previewPosts?.map(post => {
            const thumbUrl = post.content?.thumbnailUrl || post.content?.url || post.content?.jpegUrl || '';
            return `
                        <div class="image-card">
                            <img src="${escapeHtml(thumbUrl)}" loading="lazy">
                        </div>
                    `;
        }).join('') || '<div class="col-span-full text-center p-8 text-muted">No posts in this board</div>'}
            </div>
        `;

        modal.classList.add('visible');
    } catch (e) {
        console.error('Failed to load board details:', e);
        showToast('Failed to load board details', 'error');
    }
}

function closeBoardModal() {
    document.getElementById('boardModal').classList.remove('visible');
}

async function deleteCmsBoard(id) {
    if (!confirm('Are you sure you want to delete this board? The posts inside will not be deleted, only the board organization.')) return;

    try {
        await api(`/api/cms/boards/${id}`, { method: 'DELETE' });
        showToast('Board deleted', 'success');
        loadCmsBoards();
    } catch (e) {
        console.error('Failed to delete board:', e);
        showToast('Failed to delete board', 'error');
    }
}

// ============================================
// CMS: IDEAS PAGE
// ============================================

async function renderIdeasPage(container) {
    container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">Ideas (Categories)</h1>
            <div class="page-actions">
                <button class="btn btn-primary" onclick="openAddIdeaModal()">+ Add Idea</button>
            </div>
        </div>

        <div class="tabs mb-6 border-b border-white/10 flex gap-6">
            <button class="tab-btn active" id="tab-active" onclick="switchIdeaTab('active')" 
                style="padding-bottom: 0.75rem; border-bottom: 2px solid var(--primary); color: white;">
                Active Ideas
            </button>
            <button class="tab-btn" id="tab-suggestions" onclick="switchIdeaTab('suggestions')"
                style="padding-bottom: 0.75rem; border-bottom: 2px solid transparent; color: var(--text-muted);">
                Suggestions <span id="suggestionCount" class="badge badge-secondary ml-1" style="font-size: 10px; opacity: 0;">0</span>
            </button>
        </div>

        <!-- Active Ideas View -->
        <div id="activeIdeasView">
            <div id="ideasGrid" class="ideas-grid">
                <div class="col-span-full text-center text-muted">Loading ideas...</div>
            </div>
        </div>

        <!-- Suggestions View -->
        <div id="suggestionsView" style="display: none;">
            <div id="suggestionsList" class="flex flex-col gap-4">
                <div class="text-center text-muted">Loading suggestions...</div>
            </div>
        </div>
    `;

    // Load initial data
    loadCmsIdeas();
    loadCmsSuggestions();
}

function switchIdeaTab(tab) {
    const activeView = document.getElementById('activeIdeasView');
    const suggestionsView = document.getElementById('suggestionsView');
    const activeTab = document.getElementById('tab-active');
    const suggestionsTab = document.getElementById('tab-suggestions');

    if (tab === 'active') {
        activeView.style.display = 'grid';
        suggestionsView.style.display = 'none';

        activeTab.style.borderBottomColor = 'var(--primary)';
        activeTab.style.color = 'white';
        suggestionsTab.style.borderBottomColor = 'transparent';
        suggestionsTab.style.color = 'var(--text-muted)';
    } else {
        activeView.style.display = 'none';
        suggestionsView.style.display = 'block';

        activeTab.style.borderBottomColor = 'transparent';
        activeTab.style.color = 'var(--text-muted)';
        suggestionsTab.style.borderBottomColor = 'var(--primary)';
        suggestionsTab.style.color = 'white';
    }
}

async function loadCmsIdeas() {
    const grid = document.getElementById('ideasGrid');
    if (!grid) return;

    try {
        const data = await api('/api/cms/ideas');
        state.cmsIdeas = data.ideas;
        renderIdeasGrid();
    } catch (e) {
        console.error('Failed to load ideas:', e);
        grid.innerHTML = '<div class="col-span-full text-center text-danger">Failed to load ideas</div>';
    }
}

async function loadCmsSuggestions() {
    const list = document.getElementById('suggestionsList');
    const badge = document.getElementById('suggestionCount');

    try {
        const data = await api('/api/cms/ideas/suggestions');
        state.cmsSuggestions = data.suggestions;

        if (badge) {
            badge.textContent = state.cmsSuggestions.length;
            badge.style.opacity = state.cmsSuggestions.length > 0 ? '1' : '0';
        }

        if (list) renderSuggestionsList();
    } catch (e) {
        console.error('Failed to load suggestions:', e);
        if (list) list.innerHTML = '<div class="text-center text-danger">Failed to load suggestions</div>';
    }
}

function renderIdeasGrid() {
    const grid = document.getElementById('ideasGrid');
    if (!grid) return;

    if (state.cmsIdeas.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center text-muted">No ideas found. Create one!</div>';
        return;
    }

    grid.innerHTML = state.cmsIdeas.map(idea => `
        <div class="idea-card" onclick="viewIdeaDetails('${idea.id}')">
            <div class="idea-card-header">
                <div class="idea-icon-circle" style="background: ${idea.color || 'var(--accent-primary-muted)'}; color: ${idea.color ? 'white' : 'var(--accent-primary)'}">
                    ${escapeHtml(idea.iconName?.split(':').pop() || '💡')}
                </div>
                <div>
                    <div class="font-bold">${escapeHtml(idea.name)}</div>
                    <div class="text-xs text-muted">/${escapeHtml(idea.slug)}</div>
                </div>
            </div>
            <div class="text-xs text-muted mb-3 line-clamp-2">${escapeHtml(idea.description || 'No description')}</div>
            <div class="idea-stats">
                <span>🖼️ ${idea.postCount || 0} posts</span>
            </div>
        </div>
    `).join('');
}

function renderSuggestionsList() {
    const list = document.getElementById('suggestionsList');
    if (!list) return;

    if (state.cmsSuggestions.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">✨</div>
                <div class="empty-state-title">No new suggestions</div>
                <div class="empty-state-description">The periodic discovery job will add new ideas here.</div>
            </div>
        `;
        return;
    }

    list.innerHTML = state.cmsSuggestions.map(s => {
        const thumbnails = s.thumbnailUrls || [];

        return `
        <div class="card p-4" id="suggestion-${s.id}">
            <div class="flex gap-6">
                <!-- Visuals -->
                <div class="flex-shrink-0 w-48">
                    <div class="grid grid-cols-2 gap-1 rounded overflow-hidden aspect-video bg-black/20">
                        ${thumbnails.slice(0, 4).map(url => `
                            <div class="bg-cover bg-center h-full" style="background-image: url('${escapeHtml(url)}')"></div>
                        `).join('')}
                    </div>
                </div>

                <!-- Content -->
                <div class="flex-grow">
                    <div class="flex justify-between items-start mb-2">
                        <div>
                            <div class="flex items-center gap-2">
                                <h3 class="font-bold text-lg">${escapeHtml(s.name)}</h3>
                                <span class="badge badge-secondary">${Math.round(s.confidence * 100)}% Match</span>
                            </div>
                            <p class="text-sm text-muted mt-1">${escapeHtml(s.description)}</p>
                        </div>
                        <div class="flex gap-2">
                            <button class="btn btn-sm btn-secondary" onclick="rejectSuggestion('${s.id}')">Start Over</button>
                            <button class="btn btn-sm btn-primary" onclick="approveSuggestion('${s.id}')">Approve Idea</button>
                        </div>
                    </div>

                    <div class="flex gap-4 text-xs mt-3 p-3 bg-white/5 rounded-lg border border-white/5">
                        <div class="flex items-center gap-2">
                            <span class="text-muted">Color:</span>
                            <span class="w-4 h-4 rounded-full border border-white/20" style="background: ${s.suggestedColor}"></span>
                            <code>${s.suggestedColor}</code>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="text-muted">Icon:</span>
                            <code>${s.suggestedIcon}</code>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="text-muted">Tags:</span>
                            <span class="text-muted italic">${(s.matchingTags || []).slice(0, 5).join(', ')}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        `;
    }).join('');
}

async function approveSuggestion(id) {
    const card = document.getElementById(`suggestion-${id}`);
    const btn = card?.querySelector('.btn-primary');
    if (btn) {
        btn.textContent = 'Approving...';
        btn.disabled = true;
    }

    try {
        await api(`/api/cms/ideas/suggestions/${id}/approve`, { method: 'POST' });
        showToast('Idea approved and created!', 'success');

        // Remove locally
        if (card) {
            card.style.opacity = '0';
            setTimeout(() => card.remove(), 300);
        }

        // Refresh both lists
        state.cmsSuggestions = state.cmsSuggestions.filter(s => s.id !== id);
        updateSuggestionCount();
        loadCmsIdeas(); // Reload active ideas

    } catch (e) {
        console.error('Failed to approve suggestion:', e);
        showToast('Failed to approve suggestion', 'error');
        if (btn) {
            btn.textContent = 'Approve Idea';
            btn.disabled = false;
        }
    }
}

async function rejectSuggestion(id) {
    if (!confirm('Reject this suggestion? It will not be shown again.')) return;

    const card = document.getElementById(`suggestion-${id}`);

    try {
        await api(`/api/cms/ideas/suggestions/${id}/reject`, { method: 'POST' });
        showToast('Suggestion rejected', 'info');

        // Remove locally
        if (card) {
            card.style.opacity = '0';
            setTimeout(() => card.remove(), 300);
        }

        // Refresh list
        state.cmsSuggestions = state.cmsSuggestions.filter(s => s.id !== id);
        updateSuggestionCount();
    } catch (e) {
        console.error('Failed to reject:', e);
        showToast('Failed to reject suggestion', 'error');
    }
}

function updateSuggestionCount() {
    const badge = document.getElementById('suggestionCount');
    if (badge) {
        badge.textContent = state.cmsSuggestions.length;
        badge.style.opacity = state.cmsSuggestions.length > 0 ? '1' : '0';
    }

    // If empty after removal
    if (state.cmsSuggestions.length === 0) {
        renderSuggestionsList();
    }
}

function openAddIdeaModal() {
    state.editingIdeaId = null;
    document.getElementById('ideaModalTitle').textContent = 'Add Idea';
    document.getElementById('ideaName').value = '';
    document.getElementById('ideaSlug').value = '';
    document.getElementById('ideaDescription').value = '';
    document.getElementById('ideaColor').value = '';
    document.getElementById('ideaIcon').value = '';
    document.getElementById('ideaModal').classList.add('visible');
}

async function viewIdeaDetails(id) {
    const idea = state.cmsIdeas.find(i => i.id === id);
    if (!idea) return;

    state.editingIdeaId = id;
    document.getElementById('ideaModalTitle').textContent = 'Edit Idea';
    document.getElementById('ideaName').value = idea.name;
    document.getElementById('ideaSlug').value = idea.slug;
    document.getElementById('ideaDescription').value = idea.description || '';
    document.getElementById('ideaColor').value = idea.color || '';
    document.getElementById('ideaIcon').value = idea.iconName || '';

    // Add delete functionality to the edit modal
    const modalFooter = document.querySelector('#ideaModal .modal-footer');
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.style.marginRight = 'auto';
    deleteBtn.onclick = () => deleteCmsIdea(id);

    // Remove old delete btn if exists
    const oldDelete = modalFooter.querySelector('.btn-danger');
    if (oldDelete) oldDelete.remove();
    modalFooter.prepend(deleteBtn);

    document.getElementById('ideaModal').classList.add('visible');
}

function closeIdeaModal() {
    document.getElementById('ideaModal').classList.remove('visible');
    const oldDelete = document.querySelector('#ideaModal .modal-footer .btn-danger');
    if (oldDelete) oldDelete.remove();
}

async function saveIdea() {
    const name = document.getElementById('ideaName').value.trim();
    const slug = document.getElementById('ideaSlug').value.trim();
    const description = document.getElementById('ideaDescription').value.trim();
    const color = document.getElementById('ideaColor').value.trim();
    const iconName = document.getElementById('ideaIcon').value.trim();

    if (!name || !slug) {
        showToast('Name and slug are required', 'warning');
        return;
    }

    try {
        const body = { name, slug, description, color, iconName };
        if (state.editingIdeaId) {
            await api(`/api/cms/ideas/${state.editingIdeaId}`, {
                method: 'PUT',
                body: JSON.stringify(body),
            });
            showToast('Idea updated', 'success');
        } else {
            await api('/api/cms/ideas', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            showToast('Idea created', 'success');
        }

        closeIdeaModal();
        await loadCmsIdeas();
    } catch (e) {
        console.error('Failed to save idea:', e);
        showToast('Failed to save idea', 'error');
    }
}

async function deleteCmsIdea(id) {
    if (!confirm('Are you sure you want to delete this idea?')) return;

    try {
        await api(`/api/cms/ideas/${id}`, { method: 'DELETE' });
        showToast('Idea deleted', 'success');
        closeIdeaModal();
        await loadCmsIdeas();
    } catch (e) {
        console.error('Failed to delete idea:', e);
        showToast('Failed to delete idea', 'error');
    }
}

// ============================================
// CMS: ANALYTICS PAGE
// ============================================

async function renderAnalyticsPage(container) {
    container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">Platform Analytics</h1>
            <div class="page-actions">
                <button class="btn btn-secondary" onclick="loadCmsAnalytics()">🔄 Refresh</button>
            </div>
        </div>

        <div id="analyticsOverview" class="stats-grid mb-6">
            <div class="stat-card"><div class="stat-value">...</div><div class="stat-label">Total Users</div></div>
            <div class="stat-card"><div class="stat-value">...</div><div class="stat-label">Total Posts</div></div>
            <div class="stat-card"><div class="stat-value">...</div><div class="stat-label">Boards</div></div>
            <div class="stat-card"><div class="stat-value">...</div><div class="stat-label">Ideas</div></div>
        </div>

        <div class="analytics-grid">
            <div class="card">
                <div class="card-header"><span class="card-title">⚙️ Processing Health</span></div>
                <div class="card-body">
                    <div id="processingStats" class="flex flex-col gap-4">
                        <!-- Filled dynamically -->
                        <div class="text-center text-muted">Loading metrics...</div>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-header"><span class="card-title">🛡️ Moderation Queue</span></div>
                <div class="card-body">
                    <div id="moderationStats" class="flex flex-col gap-4">
                        <!-- Filled dynamically -->
                        <div class="text-center text-muted">Loading metrics...</div>
                    </div>
                </div>
            </div>
        </div>

        <div class="card mt-6">
            <div class="card-header"><span class="card-title">📈 Growth Trend (Last 30 Days)</span></div>
            <div class="card-body">
                <div id="growthChart" class="flex items-center justify-center text-muted" style="height: 300px; background: var(--bg-tertiary); border-radius: var(--radius-lg);">
                    Chart implementation pending (integrate Chart.js if required)
                </div>
                <div id="growthTable" class="mt-4">
                    <!-- Text summary of growth -->
                </div>
            </div>
        </div>
    `;

    await loadCmsAnalytics();
}

async function loadCmsAnalytics() {
    try {
        const data = await api('/api/cms/analytics/overview');
        state.cmsAnalytics = data;
        renderAnalyticsOverview();

        // Also fetch growth data
        const growthData = await api('/api/cms/analytics/growth?days=30');
        renderGrowthData(growthData.growth);
    } catch (e) {
        console.error('Failed to load analytics:', e);
        showToast('Failed to load analytics', 'error');
    }
}

function renderAnalyticsOverview() {
    const overview = document.getElementById('analyticsOverview');
    const processing = document.getElementById('processingStats');
    const moderation = document.getElementById('moderationStats');
    if (!overview || !state.cmsAnalytics) return;

    const { totals, processing: proc, moderation: mod } = state.cmsAnalytics;

    overview.innerHTML = `
        <div class="stat-card">
            <div class="stat-value">${totals.users.toLocaleString()}</div>
            <div class="stat-label">Total Users</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${totals.posts.toLocaleString()}</div>
            <div class="stat-label">Total Posts</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${totals.boards.toLocaleString()}</div>
            <div class="stat-label">Total Boards</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${totals.ideas.toLocaleString()}</div>
            <div class="stat-label">Total Ideas</div>
        </div>
    `;

    processing.innerHTML = `
        <div class="flex justify-between items-center">
            <span class="text-sm">Completed</span>
            <span class="badge badge-success">${proc.completed.toLocaleString()}</span>
        </div>
        <div class="progress-bar">
            <div class="progress-fill success" style="width: ${(proc.completed / (totals.posts || 1) * 100).toFixed(1)}%"></div>
        </div>
        <div class="flex justify-between items-center">
            <span class="text-sm">Pending</span>
            <span class="badge badge-info">${proc.pending.toLocaleString()}</span>
        </div>
        <div class="flex justify-between items-center">
            <span class="text-sm">Failed</span>
            <span class="badge badge-danger">${proc.failed.toLocaleString()}</span>
        </div>
    `;

    moderation.innerHTML = `
        <div class="flex justify-between items-center">
            <span class="text-sm">Awaiting Moderation</span>
            <span class="badge badge-warning">${mod.awaitingModeration.toLocaleString()}</span>
        </div>
        <div class="flex justify-between items-center">
            <span class="text-sm">Flagged for Review</span>
            <span class="badge badge-danger">${mod.flagged.toLocaleString()}</span>
        </div>
        <button class="btn btn-secondary w-full mt-4" onclick="navigateTo('posts')">Go to Moderation Queue</button>
    `;
}

function renderGrowthData(growth) {
    const tableDiv = document.getElementById('growthTable');
    if (!tableDiv || !growth || growth.length === 0) return;

    const recentGrowth = growth.slice(-7); // Last 7 days
    const totalNewUsers = recentGrowth.reduce((sum, d) => sum + d.users, 0);
    const totalNewPosts = recentGrowth.reduce((sum, d) => sum + d.posts, 0);

    tableDiv.innerHTML = `
        <div class="text-sm text-muted">
            In the last 7 days, there were <b>${totalNewUsers}</b> new users and <b>${totalNewPosts}</b> new posts.
        </div>
    `;
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
