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

console.log("%c[App Check] Debug mode enabled. Look for the token above or below.", "color: yellow; font-weight: bold; font-size: 14px;");

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
    postsPerPage: 50, // 20, 50, or 100
    selectedPosts: new Set(),
    ideasViewMode: 'grid', // 'list' or 'grid'
    selectedIdeas: new Set(),
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
                    initTheme();
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

// Theme Handling
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    if (savedTheme === 'light') {
        document.body.classList.add('light-mode');
        document.getElementById('themeIcon').classList.replace('ph-moon', 'ph-sun');
    }
}

function toggleTheme() {
    const body = document.body;
    body.classList.toggle('light-mode');

    const isLight = body.classList.contains('light-mode');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');

    const icon = document.getElementById('themeIcon');
    if (isLight) {
        icon.classList.replace('ph-moon', 'ph-sun');
    } else {
        icon.classList.replace('ph-sun', 'ph-moon');
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
        '/moderation': 'moderation',
        '/posts': 'posts',
        '/users': 'users',
        '/boards': 'boards',
        '/ideas': 'autotag',
        '/autotag': 'autotag',
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
        case 'autotag':
            renderAutoTagPage(container);
            break;
        case 'analytics':
            renderAnalyticsPage(container);
            break;
        case 'moderation':
            renderModerationPage(container);
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

            <!-- Maintenance Section -->
            <div class="card">
                <div class="card-header">
                    <span class="card-title">🛠️ Background Migration</span>
                </div>
                <div class="card-body">
                    <div class="flex flex-col gap-4">
                        <div>
                            <p class="text-sm font-medium mb-1">Vertex AI Vector Migration</p>
                            <p class="text-xs text-muted mb-3">Posts are being automatically re-embedded in the background. This process is passive and won't affect performance.</p>
                            
                            <div class="mb-2 flex justify-between text-xs">
                                <span id="migrationStatusText">Calculating progress...</span>
                                <span id="migrationPercent">0%</span>
                            </div>
                            <div class="w-full bg-white/5 rounded-full h-2 mb-4 overflow-hidden">
                                <div id="migrationProgressBar" class="bg-primary h-full transition-all duration-500" style="width: 0%"></div>
                            </div>

                            <div class="grid grid-cols-2 gap-4 text-center">
                                <div class="bg-white/5 p-2 rounded">
                                    <div class="text-xs text-muted">Migrated</div>
                                    <div id="migrationMigrated" class="text-sm font-bold">-</div>
                                </div>
                                <div class="bg-white/5 p-2 rounded">
                                    <div class="text-xs text-muted">Pending</div>
                                    <div id="migrationPending" class="text-sm font-bold">-</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    await loadSettingsData();
    updateMigrationStats(); // Initial fetch
}

async function backfillEmbeddings() {
    if (!confirm('This will queue all failed posts for embedding generation. Continue?')) {
        return;
    }

    try {
        const res = await api('/api/cms/posts/backfill-embeddings', {
            method: 'POST',
            body: JSON.stringify({ force: false })
        });
        showToast(res.message, 'success');
    } catch (e) {
        console.error('Failed to backfill embeddings:', e);
        showToast('Failed to trigger backfill', 'error');
    }
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
    // Fetch stats for backfill button
    let failedEmbeddings = 0;
    try {
        const analytics = await api('/api/cms/analytics/overview');
        failedEmbeddings = analytics.processing?.failedEmbeddings || 0;
    } catch (e) {
        console.warn('Failed to fetch stats for posts header', e);
    }

    container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">Posts Management</h1>
            <div class="page-actions">
                ${failedEmbeddings > 0 ? `
                    <button class="btn btn-warning mr-2" onclick="backfillEmbeddings()">
                        🧠 Backfill Embeddings (${failedEmbeddings})
                    </button>
                ` : ''}
                <div class="view-toggle mr-4">
                    <div class="view-toggle-btn ${state.postsViewMode === 'list' ? 'active' : ''}" onclick="togglePostsView('list')">List</div>
                    <div class="view-toggle-btn ${state.postsViewMode === 'grid' ? 'active' : ''}" onclick="togglePostsView('grid')">Grid</div>
                </div>
                <select class="form-select mr-2" id="postsPerPageSelect" onchange="handlePostsPerPageChange(event)" style="width: auto;">
                    <option value="20" ${state.postsPerPage === 20 ? 'selected' : ''}>20 per page</option>
                    <option value="50" ${state.postsPerPage === 50 ? 'selected' : ''}>50 per page</option>
                    <option value="100" ${state.postsPerPage === 100 ? 'selected' : ''}>100 per page</option>
                </select>
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
            limit: state.postsPerPage,
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

function handlePostsPerPageChange(event) {
    state.postsPerPage = parseInt(event.target.value, 10);
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
                        <h4 class="text-muted font-medium uppercase text-xs mb-2">Tags</h4>
                        <div class="flex gap-2 mb-2">
                            <input type="text" class="form-input" id="updatePostTags" 
                                   style="flex: 1;" 
                                   placeholder="tag1, tag2, tag3..." 
                                   value="${(post.tags || []).join(', ')}">
                            <button class="btn btn-secondary" onclick="generatePostTags('${post.id}')" id="generateTagsBtn">
                                ✨ Generate
                            </button>
                        </div>
                        <div class="text-xs text-muted">Comma-separated tags</div>
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
    const tagsInput = document.getElementById('updatePostTags').value;
    const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t.length > 0);
    try {
        await api(`/api/cms/posts/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ moderationStatus: status, tags }),
        });
        showToast('Post updated', 'success');
        closePostModal();
        loadCmsPosts();
    } catch (e) {
        console.error('Failed to update post:', e);
        showToast('Failed to update post', 'error');
    }
}

async function generatePostTags(postId) {
    const btn = document.getElementById('generateTagsBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '⏳ Generating...';
    btn.disabled = true;

    try {
        const result = await api(`/api/cms/posts/${postId}/generate-tags`, { method: 'POST' });
        if (result.tags && result.tags.length > 0) {
            document.getElementById('updatePostTags').value = result.tags.join(', ');
            showToast('Tags generated! Save to apply.', 'success');
        } else {
            showToast('Could not generate tags', 'warning');
        }
    } catch (e) {
        console.error('Failed to generate tags:', e);
        showToast('Failed to generate tags', 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
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
                    <div class="flex gap-2 justify-end">
                        <button class="btn btn-sm btn-secondary" onclick="viewUserDetails('${user.id}')" title="View Details">👤</button>
                        <button class="btn btn-sm ${user.banned ? 'btn-success' : 'btn-warning'}" onclick="toggleUserBan('${user.id}', ${!user.banned})" title="${user.banned ? 'Unban' : 'Ban'}">
                            ${user.banned ? '✅' : '🚫'}
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="deleteCmsUser('${user.id}')" title="Delete User">🗑️</button>
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
                        <label class="form-label">Admin Status</label>
                        <div class="flex items-center gap-4">
                            <span class="text-sm">${user.isAdmin ? 'User is an Admin' : 'User is a regular member'}</span>
                            <button class="btn btn-sm ${user.isAdmin ? 'btn-warning' : 'btn-secondary'}" 
                                onclick="toggleUserAdmin('${user.id}', ${!user.isAdmin})">
                                ${user.isAdmin ? 'Revoke Admin' : 'Make Admin'}
                            </button>
                        </div>
                    </div>

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


async function toggleUserAdmin(id, isAdmin) {
    if (!confirm(`Are you sure you want to ${isAdmin ? 'promote this user to Admin' : 'revoke Admin rights'}?`)) return;

    try {
        await api(`/api/cms/users/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ isAdmin }),
        });
        showToast(`User ${isAdmin ? 'promoted to Admin' : 'demoted'}`, 'success');
        viewUserDetails(id);
        loadCmsUsers();
    } catch (e) {
        console.error('Failed to update user:', e);
        showToast('Failed to update user: ' + e.message, 'error');
    }
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
// CMS: AUTO-TAG PAGE
// ============================================

// Auto-tag state
const autoTagState = {
    batchSize: 10,
    delayMs: 500,
    isGenerating: false,
    jobs: [], // { postId, post, suggestedTags, acceptedTags, rejectedTags }
};

async function renderAutoTagPage(container) {
    container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">Auto-Tag Posts</h1>
            <div class="page-actions">
                <button class="btn btn-secondary" onclick="clearAutoTagJobs()">Clear All</button>
            </div>
        </div>

        <!-- Rate Controls -->
        <div class="card mb-6">
            <div class="card-header">
                <span class="card-title">⚙️ Generation Settings</span>
            </div>
            <div class="card-body">
                <div class="flex gap-8" style="flex-wrap: wrap;">
                    <div class="form-group" style="flex: 1; min-width: 200px;">
                        <label class="form-label">Batch Size</label>
                        <div class="flex items-center gap-4">
                            <input type="range" id="autoTagBatchSize" min="1" max="20" value="${autoTagState.batchSize}" 
                                oninput="autoTagState.batchSize = this.value; document.getElementById('batchSizeValue').textContent = this.value"
                                style="flex: 1;">
                            <span id="batchSizeValue" class="font-bold" style="min-width: 30px;">${autoTagState.batchSize}</span>
                        </div>
                        <div class="text-xs text-muted mt-1">Number of posts to process at once</div>
                    </div>
                    <div class="form-group" style="flex: 1; min-width: 200px;">
                        <label class="form-label">Delay Between Calls (ms)</label>
                        <div class="flex items-center gap-4">
                            <input type="range" id="autoTagDelay" min="0" max="5000" step="100" value="${autoTagState.delayMs}" 
                                oninput="autoTagState.delayMs = this.value; document.getElementById('delayValue').textContent = this.value"
                                style="flex: 1;">
                            <span id="delayValue" class="font-bold" style="min-width: 50px;">${autoTagState.delayMs}</span>
                        </div>
                        <div class="text-xs text-muted mt-1">Delay between API calls to avoid rate limits</div>
                    </div>
                </div>
                <div class="mt-4 pt-4 border-t border-white/10">
                    <button class="btn btn-primary" id="generateTagsBtn" onclick="generateAutoTags()">
                        ✨ Generate Tags for Batch
                    </button>
                    <span id="autoTagProgress" class="ml-4 text-sm text-muted"></span>
                </div>
            </div>
        </div>

        <!-- Pending Jobs -->
        <div class="card">
            <div class="card-header">
                <span class="card-title">📋 Pending Tag Approvals</span>
                <div class="flex gap-2">
                    <button class="btn btn-sm btn-secondary" onclick="acceptAllAutoTags()">Accept All</button>
                    <button class="btn btn-sm btn-success" onclick="applyAutoTags()" id="applyTagsBtn" disabled>
                        💾 Apply Approved Tags
                    </button>
                </div>
            </div>
            <div class="card-body">
                <div id="autoTagJobsList">
                    <div class="empty-state">
                        <div class="empty-state-icon">🏷️</div>
                        <div class="empty-state-title">No pending tags</div>
                        <div class="empty-state-description">Click "Generate Tags" to analyze posts and suggest tags</div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

async function generateAutoTags() {
    const btn = document.getElementById('generateTagsBtn');
    const progress = document.getElementById('autoTagProgress');

    if (autoTagState.isGenerating) return;
    autoTagState.isGenerating = true;

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width: 14px; height: 14px; border-width: 2px;"></span> Generating...';

    try {
        // Fetch posts that need tags
        const result = await api('/api/cms/posts/generate-tags', {
            method: 'POST',
            body: JSON.stringify({
                limit: autoTagState.batchSize,
                delayMs: autoTagState.delayMs
            })
        });

        if (result.jobs && result.jobs.length > 0) {
            autoTagState.jobs = [...autoTagState.jobs, ...result.jobs.map(j => ({
                postId: j.postId,
                post: j.post,
                suggestedTags: j.suggestedTags || [],
                acceptedTags: new Set(),
                rejectedTags: new Set()
            }))];
            renderAutoTagJobs();
            showToast(`Generated tags for ${result.jobs.length} posts`, 'success');
        } else {
            showToast('No posts found that need tagging', 'info');
        }
    } catch (e) {
        console.error('Failed to generate tags:', e);
        showToast('Failed to generate tags: ' + e.message, 'error');
    } finally {
        autoTagState.isGenerating = false;
        btn.disabled = false;
        btn.innerHTML = '✨ Generate Tags for Batch';
        progress.textContent = '';
    }
}

function renderAutoTagJobs() {
    const container = document.getElementById('autoTagJobsList');
    const applyBtn = document.getElementById('applyTagsBtn');

    if (!container) return;

    if (autoTagState.jobs.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🏷️</div>
                <div class="empty-state-title">No pending tags</div>
                <div class="empty-state-description">Click "Generate Tags" to analyze posts and suggest tags</div>
            </div>
        `;
        if (applyBtn) applyBtn.disabled = true;
        return;
    }

    // Enable apply button if any job has accepted tags
    const hasAccepted = autoTagState.jobs.some(j => j.acceptedTags.size > 0);
    if (applyBtn) applyBtn.disabled = !hasAccepted;

    container.innerHTML = autoTagState.jobs.map((job, idx) => {
        const thumbUrl = job.post?.content?.thumbnailUrl || job.post?.content?.url || '';
        const currentTags = job.post?.tags || [];

        return `
            <div class="autotag-job card mb-4" style="padding: 1rem; background: rgba(255,255,255,0.03);" id="autotag-job-${idx}">
                <div class="flex gap-4" style="flex-wrap: wrap;">
                    <!-- Thumbnail -->
                    <div style="flex-shrink: 0; width: 120px;">
                        <img src="${escapeHtml(thumbUrl)}" 
                            style="width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; background: rgba(0,0,0,0.3);"
                            loading="lazy">
                    </div>
                    
                    <!-- Content -->
                    <div style="flex: 1; min-width: 200px;">
                        <div class="text-xs text-muted mb-1">Post ID: ${job.postId}</div>
                        <div class="text-xs text-muted mb-3">Current tags: ${currentTags.length > 0 ? currentTags.join(', ') : 'None'}</div>
                        
                        <div class="mb-2 font-medium text-sm">Suggested Tags:</div>
                        <div class="flex flex-wrap gap-2 items-center" id="suggested-tags-${idx}">
                            ${job.suggestedTags.map(tag => {
            const isAccepted = job.acceptedTags.has(tag);
            const isRejected = job.rejectedTags.has(tag);
            const stateClass = isAccepted ? 'badge-success' : isRejected ? 'badge-danger' : 'badge-secondary';
            return `
                                    <span class="badge ${stateClass}" style="cursor: pointer; user-select: none; display: inline-flex; align-items: center; gap: 4px;">
                                        <span onclick="toggleAutoTag(${idx}, '${escapeHtml(tag)}')" title="Click to toggle">
                                            ${escapeHtml(tag)}${isAccepted ? ' ✓' : isRejected ? ' ✗' : ''}
                                        </span>
                                        <span onclick="removeTagFromJob(${idx}, '${escapeHtml(tag)}')" 
                                            style="opacity: 0.6; cursor: pointer; font-size: 14px; margin-left: 2px;"
                                            title="Remove tag">×</span>
                                    </span>
                                `;
        }).join('')}
                            <!-- Add tag input -->
                            <div class="flex items-center gap-1">
                                <input type="text" id="add-tag-input-${idx}" 
                                    placeholder="+ add tag" 
                                    style="width: 80px; padding: 2px 8px; font-size: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: inherit;"
                                    onkeydown="if(event.key === 'Enter') { addTagToJob(${idx}); event.preventDefault(); }">
                                <button class="btn btn-sm btn-ghost" onclick="addTagToJob(${idx})" style="padding: 2px 6px; font-size: 11px;">Add</button>
                            </div>
                        </div>
                        
                        <div class="flex gap-2 mt-3">
                            <button class="btn btn-sm btn-secondary" onclick="acceptAllJobTags(${idx})">Accept All</button>
                            <button class="btn btn-sm btn-ghost" onclick="rejectAllJobTags(${idx})">Reject All</button>
                            <button class="btn btn-sm btn-ghost text-danger" onclick="removeAutoTagJob(${idx})" style="margin-left: auto;">Remove</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function toggleAutoTag(jobIdx, tag) {
    const job = autoTagState.jobs[jobIdx];
    if (!job) return;

    if (job.acceptedTags.has(tag)) {
        job.acceptedTags.delete(tag);
        job.rejectedTags.add(tag);
    } else if (job.rejectedTags.has(tag)) {
        job.rejectedTags.delete(tag);
    } else {
        job.acceptedTags.add(tag);
    }

    renderAutoTagJobs();
}

function removeTagFromJob(jobIdx, tag) {
    const job = autoTagState.jobs[jobIdx];
    if (!job) return;

    // Remove from all sets
    const tagIndex = job.suggestedTags.indexOf(tag);
    if (tagIndex > -1) {
        job.suggestedTags.splice(tagIndex, 1);
    }
    job.acceptedTags.delete(tag);
    job.rejectedTags.delete(tag);

    renderAutoTagJobs();
}

function addTagToJob(jobIdx) {
    const job = autoTagState.jobs[jobIdx];
    if (!job) return;

    const input = document.getElementById(`add-tag-input-${jobIdx}`);
    if (!input) return;

    const newTag = input.value.trim().toLowerCase();
    if (!newTag) return;

    // Add to suggested tags if not already there
    if (!job.suggestedTags.includes(newTag)) {
        job.suggestedTags.push(newTag);
        job.acceptedTags.add(newTag); // Auto-accept custom tags
    }

    input.value = '';
    renderAutoTagJobs();
}

function acceptAllJobTags(jobIdx) {
    const job = autoTagState.jobs[jobIdx];
    if (!job) return;

    job.suggestedTags.forEach(tag => {
        job.acceptedTags.add(tag);
        job.rejectedTags.delete(tag);
    });

    renderAutoTagJobs();
}

function rejectAllJobTags(jobIdx) {
    const job = autoTagState.jobs[jobIdx];
    if (!job) return;

    job.suggestedTags.forEach(tag => {
        job.rejectedTags.add(tag);
        job.acceptedTags.delete(tag);
    });

    renderAutoTagJobs();
}

function removeAutoTagJob(jobIdx) {
    autoTagState.jobs.splice(jobIdx, 1);
    renderAutoTagJobs();
}

function acceptAllAutoTags() {
    autoTagState.jobs.forEach(job => {
        job.suggestedTags.forEach(tag => {
            job.acceptedTags.add(tag);
            job.rejectedTags.delete(tag);
        });
    });
    renderAutoTagJobs();
}

function clearAutoTagJobs() {
    autoTagState.jobs = [];
    renderAutoTagJobs();
}

async function applyAutoTags() {
    const btn = document.getElementById('applyTagsBtn');
    const jobsToApply = autoTagState.jobs.filter(j => j.acceptedTags.size > 0);

    if (jobsToApply.length === 0) {
        showToast('No accepted tags to apply', 'warning');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width: 14px; height: 14px; border-width: 2px;"></span> Applying...';

    let successCount = 0;
    let errorCount = 0;

    for (const job of jobsToApply) {
        try {
            const currentTags = job.post?.tags || [];
            const newTags = [...new Set([...currentTags, ...Array.from(job.acceptedTags)])];

            await api(`/api/cms/posts/${job.postId}`, {
                method: 'PUT',
                body: JSON.stringify({ tags: newTags })
            });

            successCount++;

            // Remove from jobs list
            const idx = autoTagState.jobs.indexOf(job);
            if (idx > -1) autoTagState.jobs.splice(idx, 1);
        } catch (e) {
            console.error(`Failed to update post ${job.postId}:`, e);
            errorCount++;
        }
    }

    renderAutoTagJobs();
    btn.disabled = false;
    btn.innerHTML = '💾 Apply Approved Tags';

    if (successCount > 0) {
        showToast(`Applied tags to ${successCount} posts`, 'success');
    }
    if (errorCount > 0) {
        showToast(`Failed to update ${errorCount} posts`, 'error');
    }
}

// ============================================
// CMS: IDEAS PAGE
// ============================================

async function renderIdeasPage(container) {
    container.innerHTML = `
            < div class="page-header" >
            <h1 class="page-title">Topics (Niches)</h1>
            <div class="page-actions">
                <div class="view-toggle mr-4">
                    <div class="view-toggle-btn ${state.ideasViewMode === 'list' ? 'active' : ''}" onclick="toggleIdeasView('list')">List</div>
                    <div class="view-toggle-btn ${state.ideasViewMode === 'grid' ? 'active' : ''}" onclick="toggleIdeasView('grid')">Grid</div>
                </div>
                <button class="btn btn-ghost mr-2" id="discoveryBtn" onclick="runTopicDiscovery()">
                    ✨ Run Discovery
                </button>
                <button class="btn btn-primary" onclick="openAddIdeaModal()">+ Add Topic</button>
            </div>
        </div >

        <div class="tabs mb-6 border-b border-white/10 flex gap-6">
            <button class="tab active" id="tab-active" onclick="switchIdeaTab('active')">
                Active Niches
            </button>
            <button class="tab" id="tab-suggestions" onclick="switchIdeaTab('suggestions')">
                Emerging / Discovered <span id="suggestionCount" class="badge badge-secondary ml-1" style="font-size: 10px; opacity: 0;">0</span>
            </button>
        </div>

        <!--Active Ideas View-- >
        <div id="activeIdeasView">
            <!-- Bulk Actions for Ideas -->
            <div class="card mb-4 hidden" id="ideasBulkActionsCard">
                <div class="card-body flex items-center gap-4">
                    <span class="text-sm"><span id="ideasSelectedCount">0</span> selected</span>
                    <button class="btn btn-sm btn-secondary" onclick="handleBulkArchiveIdeas()">Archive</button>
                    <button class="btn btn-sm btn-danger" onclick="handleBulkDeleteIdeas()">Delete</button>
                    <button class="btn btn-sm btn-ghost" onclick="clearIdeaSelection()">Clear</button>
                </div>
            </div>

            <div id="ideasContent">
                <div class="text-center text-muted">Loading topics...</div>
            </div>
        </div>

        <!--Suggestions View-- >
            <div id="suggestionsView" style="display: none;">
                <div class="flex justify-end mb-4" style="display: flex; justify-content: flex-end; margin-bottom: 1rem;">
                    <button id="btn-generate-suggestions" class="btn btn-secondary btn-sm" onclick="generateSuggestions()">
                        ✨ Run Topic Discovery
                    </button>
                </div>
                <div class="alert alert-info mb-4" style="font-size: 13px;">
                    <i class="ph ph-info"></i>
                The system automatically creates "Emerging" topics when it finds high-confidence clusters (>85%). Review and promote them here.
                </div>
                <div id="suggestionsList" class="flex flex-col gap-4">
                    <div class="text-center text-muted">Loading emerging topics...</div>
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

        activeTab.classList.add('active');
        suggestionsTab.classList.remove('active');
    } else {
        activeView.style.display = 'none';
        suggestionsView.style.display = 'block';

        activeTab.classList.remove('active');
        suggestionsTab.classList.add('active');
    }
}

async function loadCmsIdeas() {
    const grid = document.getElementById('ideasContent');
    if (!grid) return;

    try {
        const data = await api('/api/cms/ideas?status=active');
        state.cmsIdeas = data.ideas;
        renderIdeas();
    } catch (e) {
        console.error('Failed to load ideas:', e);
        grid.innerHTML = '<div class="col-span-full text-center text-danger">Failed to load topics</div>';
    }
}

async function loadCmsSuggestions() {
    const list = document.getElementById('suggestionsList');
    const badge = document.getElementById('suggestionCount');

    try {
        // Fetch emerging topics instead of suggestions
        const data = await api('/api/cms/ideas?status=emerging');
        state.cmsSuggestions = data.ideas; // Using same state var for now, acts as emerging

        if (badge) {
            badge.textContent = state.cmsSuggestions.length;
            badge.style.opacity = state.cmsSuggestions.length > 0 ? '1' : '0';
        }

        if (list) renderSuggestionsList();
    } catch (e) {
        console.error('Failed to load emerging topics:', e);
        if (list) list.innerHTML = '<div class="text-center text-danger">Failed to load emerging topics</div>';
    }
}

function renderIdeas() {
    const container = document.getElementById('ideasContent');
    if (!container) return;

    if (state.ideasViewMode === 'grid') {
        renderIdeasGrid(container);
    } else {
        renderIdeasTable(container);
    }

    updateIdeasBulkBar();
}

function renderIdeasGrid(container) {
    if (state.cmsIdeas.length === 0) {
        container.innerHTML = '<div class="col-span-full text-center text-muted">No active topics found. Create one or promote an emerging one!</div>';
        return;
    }

    container.innerHTML = `
            < div class="ideas-grid" >
                ${state.cmsIdeas.map(idea => {
        const isSelected = state.selectedIdeas.has(idea.id);

        return `
            <div class="idea-card ${isSelected ? 'selected' : ''}" style="position: relative;">
                <div class="post-grid-selection" style="position: absolute; top: 10px; right: 10px; z-index: 10;">
                    <input type="checkbox" class="post-checkbox idea-select" data-id="${idea.id}" ${isSelected ? 'checked' : ''} onchange="toggleIdeaSelection('${idea.id}')">
                </div>
                <div class="idea-card-header" onclick="viewIdeaDetails('${idea.id}')">
                    <div>
                        <div class="font-bold">${escapeHtml(idea.name)}</div>
                        <div class="text-xs text-muted">/${escapeHtml(idea.slug)}</div>
                    </div>
                </div>
                <div class="text-xs text-muted mb-3 line-clamp-2" onclick="viewIdeaDetails('${idea.id}')">${escapeHtml(idea.description || 'No description')}</div>
                <div class="idea-stats" onclick="viewIdeaDetails('${idea.id}')">
                    <span>🖼️ ${idea.postCount || 0} posts</span>
                </div>
            </div>
        `;
    }).join('')
        }
        </div >
            `;
}

function renderIdeasTable(container) {
    if (state.cmsIdeas.length === 0) {
        container.innerHTML = '<div class="text-center p-8 text-muted">No active topics found</div>';
        return;
    }

    container.innerHTML = `
            < div class="table-container" >
                <table class="cms-table">
                    <thead>
                        <tr>
                            <th style="width: 40px;"><input type="checkbox" class="post-checkbox" onchange="toggleSelectAllIdeas(event)"></th>
                            <th>Name</th>
                            <th>Slug</th>
                            <th>Color</th>
                            <th>Icon</th>
                            <th>Posts</th>
                            <th>Created</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${state.cmsIdeas.map(idea => {
        const isSelected = state.selectedIdeas.has(idea.id);
        const date = idea.createdAt ? new Date(idea.createdAt) : null;

        return `
                        <tr>
                            <td><input type="checkbox" class="post-checkbox idea-select" data-id="${idea.id}" ${isSelected ? 'checked' : ''} onchange="toggleIdeaSelection('${idea.id}')"></td>
                            <td>
                                <div class="font-medium">${escapeHtml(idea.name)}</div>
                                <div class="text-xs text-muted max-w-[200px] truncate">${escapeHtml(idea.description || '')}</div>
                            </td>
                            <td><code>${escapeHtml(idea.slug)}</code></td>
                            <td>
                                <div class="flex items-center gap-2">
                                    <span style="display:inline-block; width:12px; height:12px; border-radius:50%; background-color:${idea.color || '#666'}"></span>
                                    <span class="text-xs">${idea.color || 'N/A'}</span>
                                </div>
                            </td>
                            <td><span class="text-xs">${idea.iconName || 'N/A'}</span></td>
                            <td><span class="font-bold">${idea.postCount || 0}</span></td>
                            <td class="text-xs text-muted">${date ? getRelativeTime(date) : 'Unknown'}</td>
                            <td>
                                <div class="flex gap-2">
                                    <button class="btn btn-sm btn-secondary" onclick="viewIdeaDetails('${idea.id}')">Edit</button>
                                </div>
                            </td>
                        </tr>
                        `;
    }).join('')}
                    </tbody>
                </table>
        </div >
            `;
}

function toggleIdeasView(view) {
    state.ideasViewMode = view;
    renderIdeasPage(document.getElementById('pageContainer'));
}

function toggleIdeaSelection(id) {
    if (state.selectedIdeas.has(id)) {
        state.selectedIdeas.delete(id);
    } else {
        state.selectedIdeas.add(id);
    }
    updateIdeasBulkBar();
}

function toggleSelectAllIdeas(event) {
    const checked = event.target.checked;
    if (checked) {
        state.cmsIdeas.forEach(i => state.selectedIdeas.add(i.id));
    } else {
        state.selectedIdeas.clear();
    }
    renderIdeas();
}

function clearIdeaSelection() {
    state.selectedIdeas.clear();
    updateIdeasBulkBar();
    renderIdeas();
}

function updateIdeasBulkBar() {
    const card = document.getElementById('ideasBulkActionsCard');
    const count = document.getElementById('ideasSelectedCount');

    if (card && count) {
        const size = state.selectedIdeas.size;
        count.textContent = size;
        if (size > 0) {
            card.classList.remove('hidden');
        } else {
            card.classList.add('hidden');
        }
    }
}

async function handleBulkArchiveIdeas() {
    const ids = Array.from(state.selectedIdeas);
    if (!confirm(`Archive ${ids.length} topics ? They will be hidden from the main list.`)) return;

    try {
        await api('/api/cms/ideas/bulk/archive', {
            method: 'POST',
            body: JSON.stringify({ ids }),
        });
        showToast(`${ids.length} topics archived`, 'success');
        clearIdeaSelection();
        loadCmsIdeas();
    } catch (e) {
        console.error('Bulk archive failed:', e);
        showToast('Bulk archive failed', 'error');
    }
}

async function handleBulkDeleteIdeas() {
    const ids = Array.from(state.selectedIdeas);
    if (!confirm(`DELETE ${ids.length} topics ? This is permanent!`)) return;

    try {
        await api('/api/cms/ideas/bulk/delete', {
            method: 'POST',
            body: JSON.stringify({ ids }),
        });
        showToast(`${ids.length} topics deleted`, 'success');
        clearIdeaSelection();
        loadCmsIdeas();
    } catch (e) {
        console.error('Bulk delete failed:', e);
        showToast('Bulk delete failed', 'error');
    }
}

function renderSuggestionsList() {
    const list = document.getElementById('suggestionsList');
    if (!list) return;

    if (state.cmsSuggestions.length === 0) {
        list.innerHTML = `
            < div class="empty-state" >
                <div class="empty-state-icon">✨</div>
                <div class="empty-state-title">No emerging topics</div>
                <div class="empty-state-description">Run a discovery job to find new clusters.</div>
            </div >
            `;
        return;
    }

    list.innerHTML = state.cmsSuggestions.map(s => {
        const thumbnails = s.thumbnailUrls || [];

        return `
            < div class="card p-4" id = "suggestion-${s.id}" style = "padding: 1.5rem;" >
                <div class="flex" style="gap: 1.5rem;">
                    <!-- Visuals -->
                    <div style="flex-shrink: 0; width: 200px;">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; border-radius: 8px; overflow: hidden; aspect-ratio: 16/9; background: rgba(0,0,0,0.2);">
                            ${thumbnails.slice(0, 4).map(url => `
                            <div style="background-image: url('${escapeHtml(url)}'); background-size: cover; background-position: center; height: 100%; width: 100%;"></div>
                        `).join('')}
                            ${thumbnails.length === 0 ? '<div style="grid-column: span 2; display: flex; align-items: center; justify-content: center; color: #71717a; font-size: 12px; height: 100%;">No images</div>' : ''}
                        </div>
                    </div>

                    <!-- Content -->
                    <div style="flex: 1; min-width: 0;">
                        <div class="flex justify-between items-start mb-2" style="margin-bottom: 0.5rem; justify-content: space-between; align-items: flex-start;">
                            <div style="flex: 1; margin-right: 1rem; min-width: 0;">
                                <div class="flex items-center gap-2" style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                                    <h3 class="font-bold" style="font-size: 1.125rem; font-weight: 700; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">${escapeHtml(s.name)}</h3>
                                    <span class="badge badge-secondary" style="white-space: nowrap;">${Math.round(s.confidence * 100)}% Match</span>
                                </div>
                                <p class="text-muted mt-1" style="font-size: 0.875rem; margin-top: 0.25rem; line-height: 1.4; color: #a1a1aa;">${escapeHtml(s.description)}</p>
                            </div>
                            <div class="flex gap-2" style="display: flex; gap: 0.5rem; flex-shrink: 0;">
                                <button class="btn btn-sm btn-secondary" onclick="archiveTopic('${s.id}')">Archive</button>
                                <button class="btn btn-sm btn-primary" onclick="promoteTopic('${s.id}')">Promote to Active</button>
                            </div>
                        </div>

                        <div class="flex gap-4 text-xs mt-3 p-3 rounded-lg border" style="display: flex; gap: 1rem; margin-top: 0.75rem; padding: 0.75rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 0.5rem; font-size: 0.75rem;">
                            <div class="flex items-center gap-2" style="display: flex; align-items: center; gap: 0.5rem;">
                                <span class="text-muted" style="color: #71717a;">Color:</span>
                                <span style="width: 1rem; height: 1rem; border-radius: 9999px; border: 1px solid rgba(255,255,255,0.2); background: ${s.color || s.suggestedColor}"></span>
                                <code style="font-family: monospace;">${s.color || s.suggestedColor}</code>
                            </div>
                            <div class="flex items-center gap-2" style="display: flex; align-items: center; gap: 0.5rem;">
                                <span class="text-muted" style="color: #71717a;">Icon:</span>
                                <code style="font-family: monospace;">${s.iconName || s.suggestedIcon}</code>
                            </div>
                            <div class="flex items-center gap-2" style="display: flex; align-items: center; gap: 0.5rem;">
                                <span class="text-muted" style="color: #71717a;">Tags:</span>
                                <span class="italic" style="font-style: italic; color: #a1a1aa;">${(s.matchingTags || []).slice(0, 5).join(', ')}</span>
                            </div>
                        </div>
                    </div>
                </div>
        </div >
            `;
    }).join('');
}

async function generateSuggestions() {
    if (!confirm('This will trigger a new analysis of recent posts to find clusters. It may take 10-20 seconds. Continue?')) {
        return;
    }

    const btn = document.getElementById('btn-generate-suggestions');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner" style="width: 12px; height: 12px; border-width: 2px;"></span> Generating...';
    }

    try {
        await api('/api/cms/ideas/generate', {
            method: 'POST',
            body: JSON.stringify({ sampleSize: 300 })
        });
        showToast('Discovery job complete! Refreshing emerging topics...', 'success');

        // Wait a moment for firestore to sync
        setTimeout(() => {
            loadCmsSuggestions();
        }, 1000);
    } catch (e) {
        console.error('Generation failed:', e);
        showToast('Failed to generate suggestions: ' + (e.details || e.message), 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '✨ Generate New Suggestions';
        }
    }
}

async function promoteTopic(id) {
    const card = document.getElementById(`suggestion - ${id} `);
    const btn = card?.querySelector('.btn-primary');
    if (btn) {
        btn.textContent = 'Approving...';
        btn.disabled = true;
    }

    try {
        await api(`/ api / cms / topics / ${id}/promote`, { method: 'POST' });
        showToast('Topic promoted to Active!', 'success');

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
        console.error('Failed to promote topic:', e);
        showToast('Failed to promote topic', 'error');
        if (btn) {
            btn.textContent = 'Promote to Active';
            btn.disabled = false;
        }
    }
}

async function archiveTopic(id) {
    if (!confirm('Archive this topic? It will be hidden.')) return;

    const card = document.getElementById(`suggestion-${id}`);

    try {
        await api(`/api/cms/topics/${id}/archive`, { method: 'POST' });
        showToast('Topic archived', 'info');

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
    document.getElementById('ideaModalTitle').textContent = 'Edit Topic';
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
                <select class="form-select" id="analyticsRange" onchange="loadCmsGrowthData()">
                    <option value="7">Last 7 Days</option>
                    <option value="30" selected>Last 30 Days</option>
                    <option value="90">Last 90 Days</option>
                </select>
                <button class="btn btn-secondary" onclick="loadCmsAnalytics()">🔄 Refresh</button>
            </div>
        </div>

        <!-- High-level Stats -->
        <div id="analyticsOverview" class="stats-grid mb-6">
            <div class="stat-card"><div class="stat-value">...</div><div class="stat-label">Total Users</div></div>
            <div class="stat-card"><div class="stat-value">...</div><div class="stat-label">Total Posts</div></div>
            <div class="stat-card"><div class="stat-value">...</div><div class="stat-label">Boards</div></div>
            <div class="stat-card"><div class="stat-value">...</div><div class="stat-label">Ideas</div></div>
        </div>

        <!-- Engagement Stats -->
        <div class="card mb-6">
            <div class="card-header"><span class="card-title">❤️ Total Engagement</span></div>
            <div class="card-body">
                <div id="engagementStats" class="flex gap-8 justify-around p-4">
                    <div class="text-center">
                        <div class="text-2xl font-bold" id="totalLikes">-</div>
                        <div class="text-muted text-sm">Likes</div>
                    </div>
                    <div class="text-center">
                        <div class="text-2xl font-bold" id="totalSaves">-</div>
                        <div class="text-muted text-sm">Saves</div>
                    </div>
                    <div class="text-center">
                        <div class="text-2xl font-bold" id="totalViews">-</div>
                        <div class="text-muted text-sm">Views</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Growth Chart -->
        <div class="card mb-6">
            <div class="card-header"><span class="card-title">📈 Growth Trend</span></div>
            <div class="card-body">
                <div style="height: 300px; position: relative;">
                    <canvas id="growthChart"></canvas>
                </div>
            </div>
        </div>

        <div class="analytics-grid">
            <!-- Top Ideas -->
            <div class="card">
                <div class="card-header"><span class="card-title">🔥 Top Ideas</span></div>
                <div class="card-body">
                    <div id="topIdeas" class="flex flex-col gap-3">
                        <div class="text-center text-muted">Loading...</div>
                    </div>
                </div>
            </div>

            <!-- Top Contributors -->
            <div class="card">
                <div class="card-header"><span class="card-title">🏆 Top Contributors (Recent)</span></div>
                <div class="card-body">
                    <div id="topUsers" class="flex flex-col gap-3">
                        <div class="text-center text-muted">Loading...</div>
                    </div>
                </div>
            </div>
        </div>

        <div class="analytics-grid mt-6">
            <div class="card">
                <div class="card-header"><span class="card-title">⚙️ Processing Health</span></div>
                <div class="card-body">
                    <div id="processingStats" class="flex flex-col gap-4">
                        <div class="text-center text-muted">Loading metrics...</div>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-header"><span class="card-title">🛡️ Moderation Queue</span></div>
                <div class="card-body">
                    <div id="moderationStats" class="flex flex-col gap-4">
                        <div class="text-center text-muted">Loading metrics...</div>
                    </div>
                </div>
            </div>
        </div>
    `;

    loadCmsAnalytics();
}

async function loadCmsAnalytics() {
    try {
        await Promise.all([
            loadOverviewData(),
            loadCmsGrowthData(),
            loadTopIdeas(),
            loadTopUsers()
        ]);
    } catch (e) {
        console.error('Failed to load analytics:', e);
        showToast('Failed to load analytics', 'error');
    }
}

async function loadOverviewData() {
    const data = await api('/api/cms/analytics/overview');
    state.cmsAnalytics = data;
    renderAnalyticsOverview();
}

async function loadCmsGrowthData() {
    const days = document.getElementById('analyticsRange')?.value || 30;
    try {
        const growthData = await api(`/api/cms/analytics/growth?days=${days}`);
        renderGrowthChart(growthData.growth);
    } catch (e) {
        console.error('Failed to load growth data:', e);
    }
}

async function loadTopIdeas() {
    try {
        const data = await api('/api/cms/ideas');
        const ideas = data.ideas.sort((a, b) => (b.postCount || 0) - (a.postCount || 0)).slice(0, 5);

        const container = document.getElementById('topIdeas');
        if (!container) return;

        if (ideas.length === 0) {
            container.innerHTML = '<div class="text-center text-muted">No ideas found</div>';
            return;
        }

        container.innerHTML = ideas.map(idea => `
            <div class="flex items-center justify-between p-2 rounded hover:bg-white/5 cursor-pointer" onclick="viewIdeaDetails('${idea.id}')">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded flex items-center justify-center font-bold text-white shadow-sm" 
                         style="background-color: ${idea.color || '#666'}">
                         ${(idea.name[0] || '?').toUpperCase()}
                    </div>
                    <div>
                        <div class="font-medium text-sm">${escapeHtml(idea.name)}</div>
                        <div class="text-xs text-muted">/${escapeHtml(idea.slug)}</div>
                    </div>
                </div>
                <div class="text-sm font-semibold">${idea.postCount || 0} posts</div>
            </div>
        `).join('');
    } catch (e) {
        console.error('Failed to load top ideas:', e);
    }
}

async function loadTopUsers() {
    try {
        const data = await api('/api/cms/analytics/users/top');
        const users = data.users;

        const container = document.getElementById('topUsers');
        if (!container) return;

        if (!users || users.length === 0) {
            container.innerHTML = '<div class="text-center text-muted">No data available</div>';
            return;
        }

        container.innerHTML = users.map(user => `
            <div class="flex items-center justify-between p-2 rounded hover:bg-white/5 cursor-pointer" onclick="viewUserDetails('${user.id}')">
                <div class="flex items-center gap-3">
                    <img src="${user.avatarUrl || 'https://placehold.co/32x32?text=U'}" class="w-8 h-8 rounded-full border border-white/10">
                    <div>
                        <div class="font-medium text-sm">${escapeHtml(user.username || 'User')}</div>
                        <div class="text-xs text-muted">Recent Activity</div>
                    </div>
                </div>
                <div class="text-sm font-semibold">${user.recentPostCount || 0} posts</div>
            </div>
        `).join('');
    } catch (e) {
        console.error('Failed to load top users:', e);
    }
}

function renderAnalyticsOverview() {
    const overview = document.getElementById('analyticsOverview');
    const processing = document.getElementById('processingStats');
    const moderation = document.getElementById('moderationStats');

    // Engagement stats
    const likesEl = document.getElementById('totalLikes');
    const savesEl = document.getElementById('totalSaves');
    const viewsEl = document.getElementById('totalViews');

    if (!overview || !state.cmsAnalytics) return;

    const { totals, processing: proc, moderation: mod, engagement } = state.cmsAnalytics;

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

    if (likesEl && engagement) {
        likesEl.textContent = engagement.likes.toLocaleString();
        savesEl.textContent = engagement.saves.toLocaleString();
        viewsEl.textContent = engagement.views.toLocaleString();
    }

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

function renderGrowthChart(growth) {
    const ctx = document.getElementById('growthChart');
    if (!ctx) return;

    // Destroy existing chart if any
    if (window.growthChartInstance) {
        window.growthChartInstance.destroy();
    }

    const labels = growth.map(d => {
        const date = new Date(d.date);
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    });

    window.growthChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'New Users',
                    data: growth.map(d => d.users),
                    borderColor: '#22c55e',
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'New Posts',
                    data: growth.map(d => d.posts),
                    borderColor: '#6366f1',
                    backgroundColor: 'rgba(99, 102, 241, 0.1)',
                    fill: true,
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: '#a1a1aa' }
                },
                tooltip: {
                    backgroundColor: '#18181b',
                    titleColor: '#fff',
                    bodyColor: '#a1a1aa',
                    borderColor: '#27272a',
                    borderWidth: 1
                }
            },
            scales: {
                x: {
                    grid: { color: '#27272a' },
                    ticks: { color: '#71717a' }
                },
                y: {
                    grid: { color: '#27272a' },
                    ticks: { color: '#71717a' },
                    beginAtZero: true
                }
            }
        }
    });
}

// ============================================
// MODERATION PAGE
// ============================================

let moderationReports = [];

async function renderModerationPage(container) {
    container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">Moderation Queue</h1>
            <div class="page-actions">
                <button class="btn btn-secondary" onclick="loadModerationReports()">
                    ↻ Refresh
                </button>
            </div>
        </div>

        <div class="card">
            <div class="card-body" id="moderationListContainer">
                <div class="text-muted text-center">Loading reports...</div>
            </div>
        </div>
    `;

    await loadModerationReports();
}

async function loadModerationReports() {
    try {
        const data = await api('/api/cms/reports?status=pending');
        moderationReports = data.reports || [];
        renderModerationList();
    } catch (e) {
        console.error('Failed to load reports:', e);
        const container = document.getElementById('moderationListContainer');
        if (container) {
            container.innerHTML = `
                <div class="alert alert-danger">
                    Failed to load reports. Please try again.
                </div>
            `;
        }
    }
}

function renderModerationList() {
    const container = document.getElementById('moderationListContainer');
    if (!container) return;

    if (moderationReports.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">✅</div>
                <div class="empty-state-title">No pending reports</div>
                <div class="empty-state-description">All caught up! Check back later.</div>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="flex flex-col gap-4">
            ${moderationReports.map(report => renderReportCard(report)).join('')}
        </div>
    `;
}

function renderReportCard(report) {
    const post = report.post;
    const reporter = report.reporter;
    const postAuthor = report.postAuthor;
    const createdAt = report.createdAt ? new Date(report.createdAt) : null;
    const timeStr = createdAt ? getRelativeTime(createdAt) : 'Unknown';

    // Get thumbnail from post content
    let thumbnailUrl = '';
    if (post?.content?.thumbnailUrl) {
        thumbnailUrl = post.content.thumbnailUrl;
    } else if (post?.content?.url) {
        thumbnailUrl = post.content.url;
    }

    const reasonLabels = {
        spam: "It's spam",
        inappropriate: 'Inappropriate content',
        harassment: 'Harassment or hate speech',
        violence: 'Violence or dangerous organizations',
        copyright: 'Intellectual property violation',
        other: 'Other'
    };

    return `
        <div class="report-card" data-report-id="${report.id}" style="
            background: var(--bg-secondary);
            border-radius: 12px;
            padding: 16px;
            display: flex;
            gap: 16px;
            align-items: flex-start;
        ">
            <!-- Post Thumbnail -->
            <div style="flex-shrink: 0; width: 120px;">
                ${thumbnailUrl ? `
                    <img src="${escapeHtml(thumbnailUrl)}" 
                         alt="Post thumbnail" 
                         style="width: 120px; height: 120px; object-fit: cover; border-radius: 8px; cursor: pointer;"
                         onclick="viewReportedPost('${report.postId}')"
                    />
                ` : `
                    <div style="width: 120px; height: 120px; background: var(--bg-tertiary); border-radius: 8px; display: flex; align-items: center; justify-content: center;">
                        <span style="font-size: 24px; opacity: 0.5;">🖼️</span>
                    </div>
                `}
            </div>
            
            <!-- Report Info -->
            <div style="flex: 1; min-width: 0;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                    <div>
                        <span class="badge badge-warning" style="font-size: 11px;">${reasonLabels[report.reason] || report.reason}</span>
                        <span class="text-muted text-xs" style="margin-left: 8px;">${timeStr}</span>
                    </div>
                </div>
                
                <div style="margin-bottom: 8px;">
                    <div class="text-sm">
                        <span class="text-muted">Reported by:</span> 
                        <strong>${escapeHtml(reporter?.username || reporter?.displayName || 'Unknown')}</strong>
                    </div>
                    <div class="text-sm">
                        <span class="text-muted">Post Author:</span> 
                        <strong>${escapeHtml(postAuthor?.username || postAuthor?.displayName || 'Unknown')}</strong>
                    </div>
                </div>
                
                ${report.description ? `
                    <div class="text-sm text-muted" style="margin-bottom: 12px; font-style: italic;">
                        "${escapeHtml(report.description)}"
                    </div>
                ` : ''}
                
                <!-- Actions -->
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <button class="btn btn-sm btn-secondary" onclick="dismissReport('${report.id}')">
                        ✓ Dismiss
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deleteReportedPost('${report.id}')">
                        🗑️ Delete Post
                    </button>
                    <button class="btn btn-sm" onclick="banReportedUser('${report.id}')" 
                            style="background: #7f1d1d; border-color: #7f1d1d;">
                        🚫 Ban User
                    </button>
                </div>
            </div>
        </div>
    `;
}

async function viewReportedPost(postId) {
    // Open post in new tab or show modal
    // For now, let's just log or we could navigate to post page
    window.open(`https://console.firebase.google.com/project/angles-423a4/firestore/data/~2FuserPosts~2F${postId}`, '_blank');
}

async function dismissReport(reportId) {
    if (!confirm('Dismiss this report? The post will remain visible.')) return;

    try {
        await api(`/api/cms/reports/${reportId}/resolve`, { method: 'POST' });
        showToast('Report dismissed', 'success');
        await loadModerationReports();
    } catch (e) {
        console.error('Failed to dismiss report:', e);
        showToast('Failed to dismiss report', 'error');
    }
}

async function deleteReportedPost(reportId) {
    if (!confirm('Delete this post? This action cannot be undone.')) return;

    try {
        await api(`/api/cms/reports/${reportId}/delete-post`, { method: 'POST' });
        showToast('Post deleted and report resolved', 'success');
        await loadModerationReports();
    } catch (e) {
        console.error('Failed to delete post:', e);
        showToast('Failed to delete post', 'error');
    }
}

async function banReportedUser(reportId) {
    const reason = prompt('Enter ban reason (optional):', 'Violation of community guidelines');
    if (reason === null) return; // Cancelled

    if (!confirm('Ban this user? This will also delete the reported post and disable their account.')) return;

    try {
        await api(`/api/cms/reports/${reportId}/ban-user`, {
            method: 'POST',
            body: JSON.stringify({ banReason: reason })
        });
        showToast('User banned and post deleted', 'success');
        await loadModerationReports();
    } catch (e) {
        console.error('Failed to ban user:', e);
        showToast('Failed to ban user', 'error');
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

async function runTopicDiscovery() {
    const btn = document.getElementById('discoveryBtn');
    if (!btn) return;

    try {
        btn.disabled = true;
        btn.textContent = '⏱️ Running...';

        const result = await api('/api/cms/ideas/generate', {
            method: 'POST',
            body: JSON.stringify({ sampleSize: 10 })
        });

        showToast(`Discovery run complete! Found ${result.topicsFound} topics.`, 'success');
        loadCmsIdeas();
        loadCmsSuggestions();
    } catch (e) {
        console.error('Discovery failed:', e);
        showToast('Discovery process failed. Check server logs.', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '✨ Run Discovery';
    }
}

async function updateMigrationStats() {
    if (state.currentPage !== 'settings') return;

    try {
        const stats = await api('/api/cms/migration/stats');

        const migrated = stats.migrated || 0;
        const total = stats.total || 0;
        const percent = total > 0 ? Math.round((migrated / total) * 100) : 0;

        const bar = document.getElementById('migrationProgressBar');
        const pctText = document.getElementById('migrationPercent');
        const statusText = document.getElementById('migrationStatusText');
        const miCount = document.getElementById('migrationMigrated');
        const peCount = document.getElementById('migrationPending');

        if (bar) bar.style.width = `${percent}%`;
        if (pctText) pctText.textContent = `${percent}%`;
        if (statusText) statusText.textContent = percent === 100 ? '✅ Migration Complete' : '⚙️ Migrating in background...';
        if (miCount) miCount.textContent = migrated.toLocaleString();
        if (peCount) peCount.textContent = stats.pending.toLocaleString();

        // Refresh stats every 10s while on settings page
        if (state.currentPage === 'settings') {
            setTimeout(updateMigrationStats, 10000);
        }
    } catch (e) {
        console.error('Failed to update migration stats:', e);
    }
}
