/**
 * TealTask - Conversational Task Tracker
 * Rich WhatsApp/Telegram Layout with Pinned Categories
 */

// --- STATE MANAGEMENT ---
let state = {
    user: null,         // Firebase Auth User object
    userProfile: null,  // User profile from Firestore (role, displayName, ownerUid)
    tasks: [],          // Stored tasks (synced in real-time if Firebase enabled)
    teamMembers: [],    // Stored team members (if owner)
    activeEmployee: null, // Active employee object when owner is viewing employee timeline
    filters: {
        tag: 'all',  // Active category/tag filter
        search: ''   // Active search query
    },
    ui: {
        activeEditTaskId: null,
        activeMobileTab: 'stream' // 'stream' or 'checklist'
    }
};

// --- STORAGE CONSTANTS ---
const STORAGE_KEY = 'tealtask_rich_tasks_v2';

// --- FIREBASE CONFIGURATION ---
// Paste your Firebase Config here to enable cloud sync, Google Login & Office KPI Workspace.
// If left blank or empty, the app automatically runs in local storage single-user mode.
const firebaseConfig = {
    apiKey: "AIzaSyBxEVtegJnuL73xT4EHNfVfMmjU1MZlo3k",
    authDomain: "dc-task-tracker.firebaseapp.com",
    projectId: "dc-task-tracker",
    storageBucket: "dc-task-tracker.firebasestorage.app",
    messagingSenderId: "249819428503",
    appId: "1:249819428503:web:606a3c4c6bf2fb0284dbd2"
};

let db = null;
let auth = null;
let isFirebaseEnabled = false;
let tasksListenerUnsubscribe = null;
let teamListenerUnsubscribe = null;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function initApp() {
    isFirebaseEnabled = !!(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId);

    if (isFirebaseEnabled) {
        // Initialize Firebase SDK
        try {
            firebase.initializeApp(firebaseConfig);
            db = firebase.firestore();
            
            // Auto-detect and fallback to long-polling if WebSockets are blocked by proxies/VPNs/firewalls
            db.settings({ experimentalAutoDetectLongPolling: true });
            
            auth = firebase.auth();
            
            // Handle redirect result for mobile devices
            auth.getRedirectResult().catch(error => {
                console.error("Redirect auth error:", error);
                showToast("❌ Login failed: " + error.message, "error");
            });
            
            // Setup real-time authentication observer
            auth.onAuthStateChanged(handleAuthStateChanged);
        } catch (error) {
            console.error("Firebase initialization failed, falling back to Local Mode:", error);
            runLocalMode();
        }
    } else {
        runLocalMode();
    }
    
    setupEventListeners();
}

function runLocalMode() {
    isFirebaseEnabled = false;
    document.getElementById('localModeBanner').style.display = 'block';
    document.getElementById('logoutBtn').style.display = 'none';
    
    // Clear any potential leftover profile UI elements
    document.getElementById('userAvatar').innerText = "TT";
    document.getElementById('userDisplayName').innerText = "TealTask";
    document.getElementById('userRoleBadge').innerText = "Local Mode";
    document.getElementById('userRoleBadge').className = "status-online";
    document.getElementById('teamSection').style.display = 'none';

    loadTasks();
    renderChatList();
    renderTasks();
    renderChecklistPanel();
}

// --- STORAGE UTILITIES ---
function loadTasks() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
                // Backward compatibility: filter out old assistant, health and finance tags
                state.tasks = parsed.filter(t => t.tags && !t.tags.includes('assistant') && !t.tags.includes('health') && !t.tags.includes('finance'));
                saveTasks();
            } else {
                state.tasks = [];
            }
        } else {
            state.tasks = [];
        }
    } catch (e) {
        console.error("Failed to load tasks:", e);
        state.tasks = [];
    }
}

function saveTasks() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
    } catch (e) {
        console.error("Failed to save tasks:", e);
    }
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
    const taskInput = document.getElementById('taskInput');
    const btnTodo = document.getElementById('btnTodo');
    const btnDone = document.getElementById('btnDone');
    const searchInput = document.getElementById('searchInput');
    const clearAllBtn = document.getElementById('clearAllBtn');
    const loadDemoBtn = document.getElementById('loadDemoBtn');
    const welcomeDemoBtn = document.getElementById('welcomeDemoBtn');
    const exportBtn = document.getElementById('exportBtn');
    const importBtn = document.getElementById('importBtn');
    const importFileInput = document.getElementById('importFileInput');
    const backBtn = document.getElementById('backBtn');

    // Mobile Tab Navigation Buttons
    const tabBtnStream = document.getElementById('tabBtnStream');
    const tabBtnChecklist = document.getElementById('tabBtnChecklist');

    // Handle submissions via Form Submit (handles mobile keyboard "Go"/"Send")
    const chatForm = document.getElementById('chatForm');
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleTaskSubmission('todo');
    });

    const handleTodoSubmit = (e) => {
        e.preventDefault();
        handleTaskSubmission('todo');
    };

    const handleDoneSubmit = (e) => {
        e.preventDefault();
        handleTaskSubmission('done');
    };

    btnTodo.addEventListener('click', handleTodoSubmit);
    btnTodo.addEventListener('touchend', handleTodoSubmit);

    btnDone.addEventListener('click', handleDoneSubmit);
    btnDone.addEventListener('touchend', handleDoneSubmit);

    // Keyboard Shortcuts (for desktop)
    taskInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            handleTaskSubmission('done');
        }
    });

    // Live Search
    searchInput.addEventListener('input', (e) => {
        state.filters.search = e.target.value.trim().toLowerCase();
        renderTasks();
        renderChecklistPanel();
        renderChatList(); 
    });

    // Mobile Back Button
    backBtn.addEventListener('click', () => {
        document.body.classList.remove('chat-view-active');
    });

    // Mobile Tabs Click Handles
    tabBtnStream.addEventListener('click', () => switchMobileTab('stream'));
    tabBtnChecklist.addEventListener('click', () => switchMobileTab('checklist'));

    // Sidebar Header Dropdown Menu Controls
    const sidebarMenuBtn = document.getElementById('sidebarMenuBtn');
    const sidebarDropdown = document.getElementById('sidebarDropdown');

    sidebarMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebarDropdown.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
        if (sidebarDropdown && !sidebarDropdown.contains(e.target) && e.target !== sidebarMenuBtn) {
            sidebarDropdown.classList.remove('show');
        }
    });

    // Clear Workspace
    clearAllBtn.addEventListener('click', () => {
        sidebarDropdown.classList.remove('show');
        if (confirm("Delete all tasks from this space?")) {
            clearCurrentWorkspaceTasks();
        }
    });

    // Load Demo Data
    loadDemoBtn.addEventListener('click', loadDemoTasks);
    if (welcomeDemoBtn) {
        welcomeDemoBtn.addEventListener('click', loadDemoTasks);
    }

    // Export/Import
    exportBtn.addEventListener('click', () => {
        exportTasks();
        sidebarDropdown.classList.remove('show');
    });
    importBtn.addEventListener('click', () => {
        importFileInput.click();
        sidebarDropdown.classList.remove('show');
    });
    importFileInput.addEventListener('change', importTasksFromFile);

    // Auth Tabs Switching (Google vs Employee)
    const tabGoogleBtn = document.getElementById('tabGoogleBtn');
    const tabEmployeeBtn = document.getElementById('tabEmployeeBtn');
    const panelGoogle = document.getElementById('panelGoogle');
    const panelEmployee = document.getElementById('panelEmployee');

    tabGoogleBtn.addEventListener('click', () => {
        tabGoogleBtn.classList.add('active');
        tabEmployeeBtn.classList.remove('active');
        panelGoogle.style.display = 'block';
        panelGoogle.classList.add('active');
        panelEmployee.style.display = 'none';
        panelEmployee.classList.remove('active');
    });

    tabEmployeeBtn.addEventListener('click', () => {
        tabEmployeeBtn.classList.add('active');
        tabGoogleBtn.classList.remove('active');
        panelEmployee.style.display = 'block';
        panelEmployee.classList.add('active');
        panelGoogle.style.display = 'none';
        panelGoogle.classList.remove('active');
    });

    // Employee Credentials Login Form Submission
    const employeeLoginForm = document.getElementById('employeeLoginForm');
    employeeLoginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleEmployeeLogin();
    });

    // Google Login and Auth handlers
    document.getElementById('googleLoginBtn').addEventListener('click', loginWithGoogle);
    document.getElementById('logoutBtn').addEventListener('click', logout);

    // Onboarding role buttons
    document.getElementById('rolePersonalBtn').addEventListener('click', () => selectWorkspaceRole('personal'));
    document.getElementById('roleOwnerBtn').addEventListener('click', () => selectWorkspaceRole('owner'));

    // Create Team Member modals
    const inviteModal = document.getElementById('inviteModal');
    document.getElementById('addTeamBtn').addEventListener('click', () => {
        document.getElementById('inviteNameInput').value = '';
        document.getElementById('inviteEmailInput').value = '';
        document.getElementById('invitePasswordInput').value = '';
        inviteModal.classList.add('open');
    });

    const closeInviteModal = () => {
        inviteModal.classList.remove('open');
    };
    document.getElementById('inviteModalCloseBtn').addEventListener('click', closeInviteModal);
    document.getElementById('inviteCancelBtn').addEventListener('click', closeInviteModal);
    document.getElementById('inviteSubmitBtn').addEventListener('click', submitEmployeeAccount);

    // Edit Modal Event Handlers
    const editModal = document.getElementById('editModal');
    const modalCloseBtn = document.getElementById('modalCloseBtn');
    const modalCancelBtn = document.getElementById('modalCancelBtn');
    const modalSaveBtn = document.getElementById('modalSaveBtn');

    const closeModal = () => {
        editModal.classList.remove('open');
        state.ui.activeEditTaskId = null;
    };

    modalCloseBtn.addEventListener('click', closeModal);
    modalCancelBtn.addEventListener('click', closeModal);
    modalSaveBtn.addEventListener('click', saveEditedTask);
    editModal.addEventListener('click', (e) => {
        if (e.target === editModal) closeModal();
    });
}

// --- MOBILE TAB CONTROL ---
function switchMobileTab(tabName) {
    state.ui.activeMobileTab = tabName;
    const tabBtnStream = document.getElementById('tabBtnStream');
    const tabBtnChecklist = document.getElementById('tabBtnChecklist');

    if (tabName === 'checklist') {
        tabBtnChecklist.classList.add('active');
        tabBtnStream.classList.remove('active');
        document.body.classList.add('mobile-view-checklist');
        renderChecklistPanel();
    } else {
        tabBtnStream.classList.add('active');
        tabBtnChecklist.classList.remove('active');
        document.body.classList.remove('mobile-view-checklist');
        renderTasks();
        scrollToBottom();
    }
}

// --- SUBMISSION LOGIC ---
function handleTaskSubmission(type) {
    const input = document.getElementById('taskInput');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    input.style.height = 'auto';
    input.focus();

    // 1. Intercept if in Saved Messages (Notes)
    if (state.filters.tag === 'notes') {
        createAndAddNote(text);
        return;
    }

    // 3. Intercept if completing a task with Done
    if (type === 'done') {
        const matched = attemptToCompleteMatchingTodo(text);
        if (matched) return;
    }

    // 4. Default task creation
    createAndAddTask(text, type);
}

// Create a plain text message note (no checkbox/completion)
function createAndAddNote(text) {
    const timestamp = Date.now();
    const newNote = {
        text: text,
        type: 'todo', // Rendered left-aligned
        status: 'completed', // Marked completed so no checkbox shows
        timestamp: timestamp,
        completedTimestamp: timestamp,
        tags: ['notes']
    };

    if (isFirebaseEnabled) {
        let targetUid = state.user.uid;
        let ownerUid = null;

        if (state.userProfile.role === 'employee') {
            ownerUid = state.userProfile.ownerUid;
        } else if (state.userProfile.role === 'owner') {
            const activeTag = state.filters.tag;
            if (activeTag && activeTag.startsWith('employee_')) {
                targetUid = activeTag.replace('employee_', '');
                ownerUid = state.user.uid;
            } else {
                ownerUid = state.user.uid;
            }
        }

        newNote.uid = targetUid;
        if (ownerUid) newNote.ownerUid = ownerUid;
        newNote.createdBy = state.user.uid;

        db.collection('tasks').add(newNote).catch(error => {
            console.error("Failed to add note:", error);
        });
    } else {
        newNote.id = 'note_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
        state.tasks.push(newNote);
        saveTasks();
        renderChatList();
        renderTasks();
        scrollToBottom();
    }
}

function getLocalDateString(dateObj) {
    return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
}

function createAndAddTask(text, type, customTimestamp = null) {
    const timestamp = customTimestamp || Date.now();
    const tags = extractHashtags(text);

    const todayStr = getLocalDateString(new Date(timestamp));
    const tomorrowStr = getLocalDateString(new Date(timestamp + 24 * 60 * 60 * 1000));
    const isTomorrow = /(\btomorrow\b|\btmrw\b|\bকাল\b|\bআগামীকাল\b)/i.test(text);

    // Auto-bind category if we are filtering a specific system/custom workspace
    let finalText = text;
    let finalTags = [...tags];
    const systemTags = ['work', 'personal'];
    
    if (systemTags.includes(state.filters.tag) && !tags.includes(state.filters.tag)) {
        finalText = `${text} #${state.filters.tag}`;
        finalTags.push(state.filters.tag);
    } else if (state.filters.tag !== 'all' && state.filters.tag !== 'today' && state.filters.tag !== 'tomorrow' && !state.filters.tag.startsWith('employee_') && !tags.includes(state.filters.tag)) {
        // Custom hashtag folder
        finalText = `${text} #${state.filters.tag}`;
        finalTags.push(state.filters.tag);
    }
    
    let dueDateStr = todayStr;
    if (state.filters.tag === 'tomorrow') {
        dueDateStr = tomorrowStr;
        if (!isTomorrow) {
            finalText = `${text} tomorrow`;
        }
    } else {
        dueDateStr = isTomorrow ? tomorrowStr : todayStr;
    }
    
    if (dueDateStr === tomorrowStr && state.filters.tag !== 'tomorrow') {
        showToast("📅 Scheduled in Tomorrow's Plan", "success");
    }
    
    const newTask = {
        text: finalText,
        type: type, // 'todo' | 'done'
        status: type === 'done' ? 'completed' : 'pending',
        timestamp: timestamp,
        completedTimestamp: type === 'done' ? timestamp : null,
        tags: finalTags,
        dueDate: dueDateStr
    };

    if (isFirebaseEnabled) {
        let targetUid = state.user.uid;
        let ownerUid = null;

        if (state.userProfile.role === 'employee') {
            ownerUid = state.userProfile.ownerUid;
        } else if (state.userProfile.role === 'owner') {
            const activeTag = state.filters.tag;
            if (activeTag && activeTag.startsWith('employee_')) {
                targetUid = activeTag.replace('employee_', '');
                ownerUid = state.user.uid;
            } else {
                ownerUid = state.user.uid;
            }
        }

        newTask.uid = targetUid;
        if (ownerUid) newTask.ownerUid = ownerUid;
        newTask.createdBy = state.user.uid;

        // Optimistically render task in UI locally first
        const tempId = 'temp_' + Date.now();
        const optimisticTask = { id: tempId, ...newTask };
        state.tasks.push(optimisticTask);
        state.tasks.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        renderChatList();
        renderTasks();
        renderChecklistPanel();

        db.collection('tasks').add(newTask).catch(error => {
            console.error("Failed to add task:", error);
            showToast("❌ Database write failed.", "error");
            // Rollback optimistic update
            state.tasks = state.tasks.filter(t => t.id !== tempId);
            renderChatList();
            renderTasks();
            renderChecklistPanel();
        });
    } else {
        newTask.id = 'task_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
        state.tasks.push(newTask);
        saveTasks();
        renderChatList();
        renderTasks();
        renderChecklistPanel();
    }
    
    if (window.innerWidth <= 992 && state.ui.activeMobileTab !== 'stream') {
        switchMobileTab('stream');
    } else {
        scrollToBottom();
    }
}

/**
 * Normalizes text for comparison
 */
function normalizeText(str) {
    return str
        .toLowerCase()
        .replace(/#\w+/g, '')
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "")
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Fuzzy matches text to mark To-Do tasks complete
 */
function attemptToCompleteMatchingTodo(searchText) {
    const normalizedSearch = normalizeText(searchText);
    if (!normalizedSearch) return false;

    const pendingTodos = state.tasks.filter(t => 
        t.type === 'todo' && 
        t.status === 'pending' && 
        t.tags && !t.tags.includes('notes')
    );
    
    let match = pendingTodos.find(t => normalizeText(t.text) === normalizedSearch);
    
    if (!match) {
        match = pendingTodos.find(t => {
            const normalizedTodo = normalizeText(t.text);
            return normalizedTodo.includes(normalizedSearch) || normalizedSearch.includes(normalizedTodo);
        });
    }

    if (match) {
        const now = Date.now();
        const prevStatus = match.status;
        const prevCompletedTimestamp = match.completedTimestamp;

        // Optimistic local update
        match.status = 'completed';
        match.completedTimestamp = now;
        renderChatList();
        renderTasks();
        renderChecklistPanel();
        highlightTaskBubble(match.id);
        showToast(`✨ Completed matching task: "${match.text.split(' #')[0]}"`, "success");

        if (isFirebaseEnabled) {
            db.collection('tasks').doc(match.id).update({
                status: 'completed',
                completedTimestamp: now
            }).catch(error => {
                console.error("Failed to complete matched task in Firebase:", error);
                showToast("❌ Database write failed.", "error");
                // Rollback optimistic update
                match.status = prevStatus;
                match.completedTimestamp = prevCompletedTimestamp;
                renderChatList();
                renderTasks();
                renderChecklistPanel();
            });
        } else {
            saveTasks();
        }
        return true;
    }

}

// --- UTILITY LOGIC ---
function extractHashtags(text) {
    const matches = text.match(/#\w+/g);
    if (!matches) return [];
    return matches.map(tag => tag.toLowerCase().substring(1));
}

function scrollToBottom() {
    const chatHistory = document.getElementById('chatHistory');
    if (chatHistory) {
        setTimeout(() => {
            chatHistory.scrollTop = chatHistory.scrollHeight;
        }, 40); // 40ms wait ensures DOM is rendered and scrollHeight is updated
    }
}

function highlightTaskBubble(taskId) {
    const bubble = document.getElementById(`bubble_${taskId}`);
    if (bubble) {
        bubble.scrollIntoView({ behavior: 'smooth', block: 'center' });
        bubble.classList.add('completed-status');
        
        const checkbox = bubble.querySelector('.task-checkbox');
        if (checkbox) checkbox.checked = true;

        bubble.style.transition = 'all 0.5s ease';
        bubble.style.backgroundColor = 'var(--bubble-right)';
        
        setTimeout(() => {
            bubble.style.backgroundColor = '';
        }, 2000);
    }
}

// --- INTERACTIVE ACTIONS ---
window.toggleTaskStatus = function(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    const isCompleted = task.status === 'completed';
    const newStatus = isCompleted ? 'pending' : 'completed';
    const now = Date.now();
    
    const prevStatus = task.status;
    const prevCompletedTimestamp = task.completedTimestamp;

    // Optimistic local update
    task.status = newStatus;
    task.completedTimestamp = newStatus === 'completed' ? now : null;
    renderChatList();
    renderTasks();
    renderChecklistPanel();

    if (newStatus === 'completed') {
        showToast("Task completed! 🎉", "success");
    } else {
        showToast("Task marked as pending.", "info");
    }

    if (isFirebaseEnabled) {
        db.collection('tasks').doc(taskId).update({
            status: newStatus,
            completedTimestamp: newStatus === 'completed' ? now : null
        }).catch(error => {
            console.error("Failed to update status in Firebase:", error);
            showToast("❌ Database write failed.", "error");
            // Rollback optimistic update
            task.status = prevStatus;
            task.completedTimestamp = prevCompletedTimestamp;
            renderChatList();
            renderTasks();
            renderChecklistPanel();
        });
    } else {
        saveTasks();
    }
};

window.deleteTask = function(taskId) {
    if (confirm("Delete this message?")) {
        const deletedTask = state.tasks.find(t => t.id === taskId);
        if (!deletedTask) return;

        const prevTasks = [...state.tasks];

        // Optimistic local update
        state.tasks = state.tasks.filter(t => t.id !== taskId);
        renderChatList();
        renderTasks();
        renderChecklistPanel();
        showToast("Deleted");

        if (isFirebaseEnabled) {
            db.collection('tasks').doc(taskId).delete().catch(error => {
                console.error("Failed to delete task in Firebase:", error);
                showToast("❌ Database write failed.", "error");
                // Rollback optimistic update
                state.tasks = prevTasks;
                renderChatList();
                renderTasks();
                renderChecklistPanel();
            });
        } else {
            saveTasks();
        }
    }
};

window.openEditModal = function(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    state.ui.activeEditTaskId = taskId;
    document.getElementById('editTaskInput').value = task.text;
    
    if (task.type === 'todo') {
        document.getElementById('radioTodo').checked = true;
    } else {
        document.getElementById('radioDone').checked = true;
    }

    document.getElementById('editModal').classList.add('open');
    document.getElementById('editTaskInput').focus();
};

function saveEditedTask() {
    const taskId = state.ui.activeEditTaskId;
    if (!taskId) return;

    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    const newText = document.getElementById('editTaskInput').value.trim();
    if (!newText) return;

    const newType = document.querySelector('input[name="modalTaskType"]:checked').value;
    const newTags = extractHashtags(newText);

    let status = task.status;
    let completedTimestamp = task.completedTimestamp;

    if (task.type !== newType) {
        if (newType === 'done') {
            status = 'completed';
            completedTimestamp = completedTimestamp || Date.now();
        } else {
            status = 'pending';
            completedTimestamp = null;
        }
    }

    const prevText = task.text;
    const prevTags = [...task.tags];
    const prevType = task.type;
    const prevStatus = task.status;
    const prevCompletedTimestamp = task.completedTimestamp;

    // Optimistic local update
    task.text = newText;
    task.tags = newTags;
    task.type = newType;
    task.status = status;
    task.completedTimestamp = completedTimestamp;
    
    renderChatList();
    renderTasks();
    renderChecklistPanel();
    showToast("Updated");

    if (isFirebaseEnabled) {
        db.collection('tasks').doc(taskId).update({
            text: newText,
            tags: newTags,
            type: newType,
            status: status,
            completedTimestamp: completedTimestamp
        }).catch(error => {
            console.error("Failed to edit task in Firebase:", error);
            showToast("❌ Database write failed.", "error");
            // Rollback optimistic update
            task.text = prevText;
            task.tags = prevTags;
            task.type = prevType;
            task.status = prevStatus;
            task.completedTimestamp = prevCompletedTimestamp;
            renderChatList();
            renderTasks();
            renderChecklistPanel();
        });
    } else {
        saveTasks();
    }
    
    document.getElementById('editModal').classList.remove('open');
    state.ui.activeEditTaskId = null;
}

// --- RENDER SIDEBAR CHAT LIST ---
function renderChatList() {
    const chatList = document.getElementById('chatList');
    
    // 1. Declare permanent chats (WhatsApp/Telegram Contacts)
    const permanentChats = {
        all: { name: 'All Tasks', avatar: '💬', subtitle: 'Global stream inbox' },
        today: { name: "Today's Focus", avatar: '📌', subtitle: 'Target items for today' },
        tomorrow: { name: "Tomorrow's Plan", avatar: '📅', subtitle: 'Tasks scheduled for tomorrow' },
        notes: { name: 'Saved Messages', avatar: '📥', subtitle: 'Quick scratchpad notes' },
        work: { name: 'Work Space', avatar: '💼', subtitle: 'Tasks tagged #work' },
        personal: { name: 'Personal Space', avatar: '🏠', subtitle: 'Tasks tagged #personal' }
    };

    // Calculate dynamic state for categories
    const chatData = {};
    Object.keys(permanentChats).forEach(key => {
        chatData[key] = {
            name: permanentChats[key].name,
            avatar: permanentChats[key].avatar,
            pendingCount: 0,
            lastTask: null
        };
    });

    // Populate dynamic categories (custom tags entered by user)
    state.tasks.forEach(task => {
        if (task.tags && Array.isArray(task.tags)) {
            task.tags.forEach(tag => {
                // Exclude system tags from dynamically appearing twice
                const isSystemTag = ['notes', 'work', 'personal'].includes(tag);
                
                if (isSystemTag) return;

                if (!chatData[tag]) {
                    chatData[tag] = {
                        name: `#${tag}`,
                        avatar: tag.substring(0, 2).toUpperCase(),
                        pendingCount: 0,
                        lastTask: null
                    };
                }
            });
        }
    });

    const now = Date.now();
    const todayStr = getLocalDateString(new Date(now));
    const tomorrowStr = getLocalDateString(new Date(now + 24 * 60 * 60 * 1000));

    // Compute task counts & last message previews per space
    state.tasks.forEach(task => {
        const isNotes = task.tags && task.tags.includes('notes');
        const isWork = task.tags && task.tags.includes('work');
        const isPersonal = task.tags && task.tags.includes('personal');

        const isPending = task.status === 'pending';
        const taskDueDate = task.dueDate || getLocalDateString(new Date(task.timestamp));

        // 1. All Tasks
        if (!isNotes) {
            if (isPending) chatData.all.pendingCount++;
            if (!chatData.all.lastTask || task.timestamp > chatData.all.lastTask.timestamp) {
                chatData.all.lastTask = task;
            }
        }

        // 2. Today's Focus
        if (!isNotes) {
            const isToday = (taskDueDate === todayStr);
            if (isToday) {
                if (isPending) chatData.today.pendingCount++;
                if (!chatData.today.lastTask || task.timestamp > chatData.today.lastTask.timestamp) {
                    chatData.today.lastTask = task;
                }
            }
        }

        // 2.1 Tomorrow's Plan
        if (!isNotes) {
            const isTomorrow = (taskDueDate === tomorrowStr);
            if (isTomorrow) {
                if (isPending) chatData.tomorrow.pendingCount++;
                if (!chatData.tomorrow.lastTask || task.timestamp > chatData.tomorrow.lastTask.timestamp) {
                    chatData.tomorrow.lastTask = task;
                }
            }
        }

        // 3. Saved Messages (Notes)
        if (isNotes) {
            // Notes are plain text thoughts, pendingCount remains 0
            if (!chatData.notes.lastTask || task.timestamp > chatData.notes.lastTask.timestamp) {
                chatData.notes.lastTask = task;
            }
        }

        // 4. Work
        if (isWork && !isNotes) {
            if (isPending) chatData.work.pendingCount++;
            if (!chatData.work.lastTask || task.timestamp > chatData.work.lastTask.timestamp) {
                chatData.work.lastTask = task;
            }
        }

        // 5. Personal
        if (isPersonal && !isNotes) {
            if (isPending) chatData.personal.pendingCount++;
            if (!chatData.personal.lastTask || task.timestamp > chatData.personal.lastTask.timestamp) {
                chatData.personal.lastTask = task;
            }
        }

        // 6. Custom dynamic tags
        if (task.tags && Array.isArray(task.tags)) {
            task.tags.forEach(tag => {
                if (chatData[tag] && !['notes', 'work', 'personal'].includes(tag)) {
                    if (isPending) chatData[tag].pendingCount++;
                    if (!chatData[tag].lastTask || task.timestamp > chatData[tag].lastTask.timestamp) {
                        chatData[tag].lastTask = task;
                    }
                }
            });
        }
    });

    // Make sure active filter key is validated
    if (!chatData[state.filters.tag]) {
        state.filters.tag = 'all';
    }

    let html = '';
    const sortedKeys = Object.keys(chatData);

    sortedKeys.forEach(key => {
        const item = chatData[key];
        const isActive = state.filters.tag === key;
        
        let lastMsgText = 'No tasks logged';
        let lastMsgTime = '';
        if (item.lastTask) {
            lastMsgText = item.lastTask.text.split(' #')[0];
            // Format multiline bot outputs cleanly
            if (lastMsgText.includes('\n')) {
                lastMsgText = lastMsgText.split('\n')[0] + '...';
            }
            const date = new Date(item.lastTask.timestamp);
            lastMsgTime = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
        } else if (permanentChats[key]) {
            lastMsgText = permanentChats[key].subtitle;
        }

        const badgeHtml = item.pendingCount > 0 
            ? `<span class="chat-badge">${item.pendingCount}</span>` 
            : '';

        html += `
            <div class="chat-item ${isActive ? 'active' : ''}" onclick="selectChatCategory('${key}')">
                <div class="chat-item-avatar">${item.avatar}</div>
                <div class="chat-item-details">
                    <div class="chat-item-row">
                        <span class="chat-item-name">${item.name}</span>
                        <span class="chat-item-time">${lastMsgTime}</span>
                    </div>
                    <div class="chat-item-row">
                        <span class="chat-item-preview">${lastMsgText}</span>
                        ${badgeHtml}
                    </div>
                </div>
            </div>
        `;
    });

    chatList.innerHTML = html;
}

window.selectChatCategory = function(tagKey) {
    state.filters.tag = tagKey;
    state.activeEmployee = null; // Clear selected team member view
    
    if (window.innerWidth <= 992) {
        switchMobileTab('stream');
    }

    // Toggle checklist visibility for notes on desktop
    const checklistPanel = document.getElementById('checklistPanel');
    if (tagKey === 'notes') {
        checklistPanel.style.opacity = '0.4';
    } else {
        checklistPanel.style.opacity = '1.0';
    }

    // Modify placeholder for task inputs depending on category
    const taskInput = document.getElementById('taskInput');
    if (tagKey === 'notes') {
        taskInput.placeholder = "Write a quick note or reminder...";
    } else {
        taskInput.placeholder = "Type a task... Use #tags to categorize.";
    }

    if (isFirebaseEnabled) {
        bindTasksListener();
    } else {
        renderChatList();
        renderTasks();
        renderChecklistPanel();
    }
    
    document.body.classList.add('chat-view-active');
    
    setTimeout(scrollToBottom, 50);
};

// --- RENDER MAIN TASK STREAM ---
function renderTasks() {
    const chatHistory = document.getElementById('chatHistory');
    const welcomeMessage = document.getElementById('welcomeMessage');
    
    const chatTitle = document.getElementById('chatTitle');
    const chatSubtitle = document.getElementById('chatSubtitle');
    const headerAvatar = document.getElementById('headerAvatar');

    // Render Workspace Banner for Employee
    const workspaceBanner = document.getElementById('workspaceBanner');
    if (isFirebaseEnabled && state.userProfile && state.userProfile.role === 'employee') {
        workspaceBanner.style.display = 'flex';
        workspaceBanner.innerHTML = `<span>💼 Working in Team Workspace. Your updates are visible to your employer.</span>`;
    } else {
        workspaceBanner.style.display = 'none';
    }

    // Filter Tasks
    let filteredTasks = [...state.tasks];

    // Category routing logic
    if (state.filters.tag === 'all') {
        // Exclude notes from master inbox
        filteredTasks = filteredTasks.filter(t => t.tags && !t.tags.includes('notes'));
        chatTitle.innerText = "All Tasks";
        headerAvatar.innerHTML = "💬";
    } else if (state.filters.tag === 'today') {
        const now = Date.now();
        const todayStr = getLocalDateString(new Date(now));
        filteredTasks = filteredTasks.filter(t => {
            if (t.tags && t.tags.includes('notes')) return false;
            const taskDueDate = t.dueDate || getLocalDateString(new Date(t.timestamp));
            return (taskDueDate === todayStr);
        });
        chatTitle.innerText = "Today's Focus";
        headerAvatar.innerHTML = "📌";
    } else if (state.filters.tag === 'tomorrow') {
        const now = Date.now();
        const tomorrowStr = getLocalDateString(new Date(now + 24 * 60 * 60 * 1000));
        filteredTasks = filteredTasks.filter(t => {
            if (t.tags && t.tags.includes('notes')) return false;
            const taskDueDate = t.dueDate || getLocalDateString(new Date(t.timestamp));
            return taskDueDate === tomorrowStr;
        });
        chatTitle.innerText = "Tomorrow's Plan";
        headerAvatar.innerHTML = "📅";
    } else if (state.filters.tag === 'notes') {
        filteredTasks = filteredTasks.filter(t => t.tags && t.tags.includes('notes'));
        chatTitle.innerText = "Saved Messages";
        headerAvatar.innerHTML = "📥";
    } else if (state.filters.tag.startsWith('employee_')) {
        const employeeUid = state.filters.tag.replace('employee_', '');
        const member = state.teamMembers.find(m => m.uid === employeeUid);
        const name = member ? member.displayName : "Employee";
        
        filteredTasks = filteredTasks.filter(t => t.tags && !t.tags.includes('notes'));
        chatTitle.innerText = `${name}'s Timeline`;
        if (member && member.photoURL) {
            headerAvatar.innerHTML = `<img src="${member.photoURL}" alt="${name}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
        } else {
            headerAvatar.innerHTML = `<div class="avatar" style="background-color: var(--teal-primary); color: #fff; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 50%; font-weight: 600;">${name.substring(0, 2).toUpperCase()}</div>`;
        }
    } else {
        // Workspace hashtags
        filteredTasks = filteredTasks.filter(t => t.tags && t.tags.includes(state.filters.tag));
        chatTitle.innerText = `#${state.filters.tag}`;
        headerAvatar.innerHTML = state.filters.tag.substring(0, 2).toUpperCase();
    }

    // Search query filter
    if (state.filters.search) {
        filteredTasks = filteredTasks.filter(t => 
            t.text.toLowerCase().includes(state.filters.search)
        );
    }

    // Set Header Status
    const isNotes = state.filters.tag === 'notes';

    if (isNotes) {
        chatSubtitle.innerText = `${filteredTasks.length} notes saved`;
    } else {
        const pendingCount = filteredTasks.filter(t => t.status === 'pending').length;
        const completedCount = filteredTasks.filter(t => t.status === 'completed').length;
        chatSubtitle.innerText = `${pendingCount} pending • ${completedCount} completed`;
    }

    // Hide welcome overlay if tasks exist
    if (state.tasks.length === 0) {
        welcomeMessage.style.display = 'block';
        chatHistory.style.justifyContent = 'center';
        return;
    } else {
        welcomeMessage.style.display = 'none';
        chatHistory.style.justifyContent = 'flex-start';
    }

    // Group tasks by date
    const grouped = groupTasksByDate(filteredTasks);

    // Build timeline HTML
    let html = '';
    const sortedDates = Object.keys(grouped).sort((a, b) => new Date(a) - new Date(b));

    sortedDates.forEach(dateStr => {
        html += `
            <div class="date-divider">
                <span class="date-label">${formatDividerDate(dateStr)}</span>
            </div>
        `;

        grouped[dateStr].forEach(task => {
            html += renderTaskBubbleHtml(task);
        });
    });

    chatHistory.innerHTML = html;
}

function groupTasksByDate(taskList) {
    const groups = {};
    taskList.forEach(task => {
        const dateObj = new Date(task.timestamp);
        const dateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
        if (!groups[dateStr]) {
            groups[dateStr] = [];
        }
        groups[dateStr].push(task);
    });
    return groups;
}

function formatDividerDate(dateStr) {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    if (dateStr === todayStr) return 'Today';
    if (dateStr === yesterdayStr) return 'Yesterday';

    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function renderTaskBubbleHtml(task) {
    const isCompleted = task.status === 'completed';
    const isTodo = task.type === 'todo';
    
    const date = new Date(task.timestamp);
    const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    // Format text with bolding support and clickable hashtags
    let formattedText = task.text
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/#(\w+)/g, (match, tag) => {
            return `<span class="hash-tag" onclick="event.stopPropagation(); selectChatCategory('${tag.toLowerCase()}')">#${match}</span>`;
        });
        
    // Format multiline line breaks
    formattedText = formattedText.replace(/\n/g, '<br>');

    // Checkbox container
    let checkboxHtml = '';
    const isNotes = task.tags && task.tags.includes('notes');

    if (isTodo && !isCompleted && !isNotes) {
        checkboxHtml = `
            <div class="task-checkbox-container">
                <input type="checkbox" class="task-checkbox" 
                       id="check_${task.id}" 
                       onclick="toggleTaskStatus('${task.id}')"
                       aria-label="Toggle completion">
            </div>
        `;
    }

    // Determine dynamic alignment and bubble type classes based on task status
    let typeClass = 'todo-type'; 
    if (isNotes) {
        typeClass = 'todo-type'; 
    } else {
        // Normal tasks: pending on the left (todo-type), completed on the right (done-type)
        typeClass = isCompleted ? 'done-type' : 'todo-type';
    }

    return `
        <article class="chat-bubble-wrapper ${typeClass} ${isCompleted && !isNotes ? 'completed-status' : ''}" id="bubble_${task.id}">
            <div class="chat-bubble">
                
                <!-- Hover options menu -->
                <div class="bubble-options">
                    <button class="opt-btn" onclick="openEditModal('${task.id}')" title="Edit text">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                    </button>
                    <button class="opt-btn del-btn" onclick="deleteTask('${task.id}')" title="Delete message">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>
                </div>

                <div class="bubble-row">
                    ${checkboxHtml}
                    <div class="task-text">${formattedText}</div>
                </div>

                <div class="bubble-footer">
                    <span class="bubble-time">${timeStr}</span>
                    <span class="check-ticks">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M17 5L9.5 12.5L6 9" />
                            <path d="M22 5L14.5 12.5L13 11" />
                        </svg>
                    </span>
                </div>

            </div>
        </article>
    `;
}

// --- RENDER STRUCTURED CHECKLIST BOARD (RIGHT PANE) ---
function renderChecklistPanel() {
    const pendingList = document.getElementById('pendingTasksList');
    const completedList = document.getElementById('completedTasksList');
    const categoryLabel = document.getElementById('checklistActiveCategory');
    const kpiStatsContainer = document.getElementById('kpiStatsContainer');
    
    const pendingCountLabel = document.getElementById('pendingCountLabel');
    const completedCountLabel = document.getElementById('completedCountLabel');

    const activeTag = state.filters.tag;

    // Handle bot or notes threads (no checklist layout needed)
    if (activeTag === 'notes') {
        categoryLabel.innerText = 'Saved Messages';
        pendingCountLabel.innerText = '0';
        completedCountLabel.innerText = '0';
        pendingList.innerHTML = `<div class="empty-state">Saved Messages acts as a scratchpad. Checkboxes are disabled.</div>`;
        completedList.innerHTML = `<div class="empty-state">No checklist entries tracking here.</div>`;
        kpiStatsContainer.style.display = 'none';
        return;
    }

    // Filter Tasks
    let filteredTasks = [...state.tasks];

    // Category routing
    if (activeTag === 'all') {
        filteredTasks = filteredTasks.filter(t => t.tags && !t.tags.includes('notes'));
        categoryLabel.innerText = 'All Tasks';
        kpiStatsContainer.style.display = 'none';
    } else if (activeTag === 'today') {
        const now = Date.now();
        const todayStr = getLocalDateString(new Date(now));
        filteredTasks = filteredTasks.filter(t => {
            if (t.tags && t.tags.includes('notes')) return false;
            const taskDueDate = t.dueDate || getLocalDateString(new Date(t.timestamp));
            return (taskDueDate === todayStr);
        });
        categoryLabel.innerText = "Today's Focus";
        kpiStatsContainer.style.display = 'none';
    } else if (activeTag === 'tomorrow') {
        const now = Date.now();
        const tomorrowStr = getLocalDateString(new Date(now + 24 * 60 * 60 * 1000));
        filteredTasks = filteredTasks.filter(t => {
            if (t.tags && t.tags.includes('notes')) return false;
            const taskDueDate = t.dueDate || getLocalDateString(new Date(t.timestamp));
            return taskDueDate === tomorrowStr;
        });
        categoryLabel.innerText = "Tomorrow's Plan";
        kpiStatsContainer.style.display = 'none';
    } else if (activeTag.startsWith('employee_')) {
        const employeeUid = activeTag.replace('employee_', '');
        const member = state.teamMembers.find(m => m.uid === employeeUid);
        const name = member ? member.displayName : "Employee";
        
        filteredTasks = filteredTasks.filter(t => t.tags && !t.tags.includes('notes'));
        categoryLabel.innerText = `${name}'s Timeline`;
        
        // Calculate KPI Ratings for this employee
        const total = filteredTasks.length;
        const completed = filteredTasks.filter(t => t.status === 'completed').length;
        const rate = total === 0 ? 0 : Math.round((completed / total) * 100);

        kpiStatsContainer.style.display = 'block';
        kpiStatsContainer.innerHTML = `
            <div class="kpi-section">
                <div class="kpi-card">
                    <span class="kpi-label">KPI Score</span>
                    <span class="kpi-value">${rate}%</span>
                </div>
                <div class="kpi-card">
                    <span class="kpi-label">Tasks Done</span>
                    <span class="kpi-value">${completed}/${total}</span>
                </div>
            </div>
        `;
    } else {
        filteredTasks = filteredTasks.filter(t => t.tags && t.tags.includes(activeTag));
        categoryLabel.innerText = `#${activeTag}`;
        kpiStatsContainer.style.display = 'none';
    }

    // Search query filter
    if (state.filters.search) {
        filteredTasks = filteredTasks.filter(t => 
            t.text.toLowerCase().includes(state.filters.search)
        );
    }

    const pendingTasks = filteredTasks.filter(t => t.status === 'pending');
    const completedTasks = filteredTasks.filter(t => t.status === 'completed');

    // Update Label UI
    pendingCountLabel.innerText = pendingTasks.length;
    completedCountLabel.innerText = completedTasks.length;

    // Render pending checklist
    if (pendingTasks.length === 0) {
        pendingList.innerHTML = `<div class="empty-state">No pending tasks. Write one in the chat!</div>`;
    } else {
        pendingTasks.sort((a,b) => a.timestamp - b.timestamp);
        pendingList.innerHTML = pendingTasks.map(t => renderChecklistItemHtml(t)).join('');
    }

    // Render completed checklist
    if (completedTasks.length === 0) {
        completedList.innerHTML = `<div class="empty-state">No completed tasks yet.</div>`;
    } else {
        completedTasks.sort((a,b) => (b.completedTimestamp || 0) - (a.completedTimestamp || 0));
        completedList.innerHTML = completedTasks.map(t => renderChecklistItemHtml(t)).join('');
    }
}

function renderChecklistItemHtml(task) {
    const isCompleted = task.status === 'completed';
    const date = new Date(task.timestamp);
    const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    const formattedText = task.text.replace(/#(\w+)/g, (match, tag) => {
        return `<span class="hash-tag" onclick="event.stopPropagation(); selectChatCategory('${tag.toLowerCase()}')">#${tag}</span>`;
    });

    return `
        <div class="checklist-item ${isCompleted ? 'completed' : ''}" id="checklist_item_${task.id}">
            <div class="checkbox-wrapper">
                <input type="checkbox" class="task-checkbox" 
                       ${isCompleted ? 'checked' : ''} 
                       onclick="toggleTaskStatus('${task.id}')"
                       aria-label="Toggle completion">
            </div>
            <div class="item-text" ondblclick="openEditModal('${task.id}')">${formattedText}</div>
            <span class="item-time">${timeStr}</span>
            <div class="item-actions">
                <button class="item-del-btn" onclick="deleteTask('${task.id}')" title="Delete task">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            </div>
        </div>
    `;
}

// --- TOAST ALERTS ---
function showToast(message, type = "info") {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'success' ? 'toast-success' : ''}`;
    
    let icon = "💡";
    if (type === "success") icon = "✓";

    toast.innerHTML = `<span>${icon}</span> ${message}`;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// --- DEMO DATA LOADER ---
function loadDemoTasks() {
    const now = Date.now();
    const oneHour = 3600 * 1000;
    const oneDay = 24 * 3600 * 1000;

    const demoTasks = [
        {
            text: 'Finish writing proposal outline #work',
            type: 'todo',
            status: 'completed',
            timestamp: now - (2 * oneDay) - (4 * oneHour),
            completedTimestamp: now - (2 * oneDay) - (3 * oneHour),
            tags: ['work']
        },
        {
            text: 'Buy milk, coffee and fresh fruits #personal',
            type: 'todo',
            status: 'completed',
            timestamp: now - oneDay - (8 * oneHour),
            completedTimestamp: now - oneDay - (7 * oneHour),
            tags: ['personal']
        },
        {
            text: 'Setup code repository and project scaffolding #work',
            type: 'todo',
            status: 'pending',
            timestamp: now - (5 * oneHour),
            completedTimestamp: null,
            tags: ['work']
        },
        {
            text: '30-minute evening running session #personal',
            type: 'done',
            status: 'completed',
            timestamp: now - (3 * oneHour),
            completedTimestamp: now - (3 * oneHour),
            tags: ['personal']
        },
        {
            text: 'Call client to schedule feedback call #work',
            type: 'todo',
            status: 'pending',
            timestamp: now - (2 * oneHour),
            completedTimestamp: null,
            tags: ['work']
        },
        {
            text: 'Draft monthly budget spreadsheet #work',
            type: 'todo',
            status: 'pending',
            timestamp: now - (30 * 60 * 1000), 
            completedTimestamp: null,
            tags: ['work']
        },
        {
            text: 'Remember to pay the electricity bill before the weekend.',
            type: 'todo',
            status: 'completed',
            timestamp: now - 4 * oneHour,
            completedTimestamp: now - 4 * oneHour,
            tags: ['notes']
        }
    ];

    if (isFirebaseEnabled) {
        let targetUid = state.user.uid;
        let ownerUid = null;

        if (state.userProfile.role === 'employee') {
            ownerUid = state.userProfile.ownerUid;
        } else if (state.userProfile.role === 'owner') {
            const activeTag = state.filters.tag;
            if (activeTag && activeTag.startsWith('employee_')) {
                targetUid = activeTag.replace('employee_', '');
                ownerUid = state.user.uid;
            } else {
                ownerUid = state.user.uid;
            }
        }

        const batch = db.batch();
        demoTasks.forEach(task => {
            const newRef = db.collection('tasks').doc();
            task.uid = targetUid;
            if (ownerUid) task.ownerUid = ownerUid;
            task.createdBy = state.user.uid;
            batch.set(newRef, task);
        });

        batch.commit().then(() => {
            showToast("✨ Sample task stream loaded!", "success");
        }).catch(error => {
            console.error("Failed to load demo tasks in Firebase:", error);
        });
    } else {
        state.tasks = [];
        demoTasks.forEach((t, i) => {
            t.id = 'd_' + i;
        });
        state.tasks.push(...demoTasks);
        saveTasks();
        renderChatList();
        renderTasks();
        renderChecklistPanel();
        showToast("✨ Sample task stream loaded!", "success");
    }

    if (window.innerWidth <= 992) {
        switchMobileTab('stream');
    } else {
        scrollToBottom();
    }
}

// --- DATA EXPORT & IMPORT ---
function exportTasks() {
    if (state.tasks.length === 0) {
        showToast("No tasks to export.");
        return;
    }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state.tasks, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `tealtask_backup_${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast("💾 Backup downloaded!");
}

function importTasksFromFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            if (Array.isArray(imported)) {
                const isValid = imported.every(item => item.text && item.type && item.status);
                if (isValid) {
                    if (isFirebaseEnabled) {
                        let targetUid = state.user.uid;
                        let ownerUid = null;

                        if (state.userProfile.role === 'employee') {
                            ownerUid = state.userProfile.ownerUid;
                        } else if (state.userProfile.role === 'owner') {
                            const activeTag = state.filters.tag;
                            if (activeTag && activeTag.startsWith('employee_')) {
                                targetUid = activeTag.replace('employee_', '');
                                ownerUid = state.user.uid;
                            } else {
                                ownerUid = state.user.uid;
                            }
                        }

                        const batch = db.batch();
                        imported.forEach(item => {
                            const newRef = db.collection('tasks').doc();
                            const cleanTask = {
                                text: item.text,
                                type: item.type,
                                status: item.status,
                                timestamp: item.timestamp || Date.now(),
                                completedTimestamp: item.completedTimestamp || null,
                                tags: item.tags || [],
                                dueDate: item.dueDate || null,
                                uid: targetUid,
                                createdBy: state.user.uid
                            };
                            if (ownerUid) cleanTask.ownerUid = ownerUid;
                            batch.set(newRef, cleanTask);
                        });

                        batch.commit().then(() => {
                            showToast("📂 Backup restored to Cloud!", "success");
                        }).catch(err => {
                            console.error("Firebase import failed:", err);
                        });
                    } else {
                        state.tasks = imported;
                        saveTasks();
                        renderChatList();
                        renderTasks();
                        renderChecklistPanel();
                        showToast("📂 Backup restored!", "success");
                    }
                } else {
                    showToast("Invalid file structure.", "error");
                }
            } else {
                showToast("Invalid file format.", "error");
            }
        } catch (err) {
            console.error(err);
            showToast("Failed to parse JSON file.", "error");
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

// --- FIREBASE SECURITY AND OPERATIONS ---
async function handleAuthStateChanged(user) {
    if (user) {
        state.user = user;
        document.getElementById('authOverlay').style.display = 'none';
        document.getElementById('logoutBtn').style.display = 'block';

        try {
            const userDoc = await db.collection('users').doc(user.uid).get();
            if (userDoc.exists) {
                state.userProfile = userDoc.data();
                completeUserLogin();
            } else {
                document.getElementById('onboardingOverlay').style.display = 'flex';
            }
        } catch (error) {
            console.error("Error reading user profile:", error);
            showToast("⚠️ Database connection error.", "error");
        }
    } else {
        state.user = null;
        state.userProfile = null;
        state.tasks = [];
        state.teamMembers = [];
        state.activeEmployee = null;

        if (tasksListenerUnsubscribe) { tasksListenerUnsubscribe(); tasksListenerUnsubscribe = null; }
        if (teamListenerUnsubscribe) { teamListenerUnsubscribe(); teamListenerUnsubscribe = null; }

        document.getElementById('authOverlay').style.display = 'flex';
        document.getElementById('onboardingOverlay').style.display = 'none';
        document.getElementById('localModeBanner').style.display = 'none';
        document.getElementById('teamSection').style.display = 'none';
        document.getElementById('logoutBtn').style.display = 'none';
        
        // Clear sidebar profiles
        document.getElementById('userAvatar').innerText = "TT";
        document.getElementById('userDisplayName').innerText = "TealTask";
        document.getElementById('userRoleBadge').innerText = "Logged Out";
    }
}

function loginWithGoogle() {
    if (!isFirebaseEnabled) return;
    const provider = new firebase.auth.GoogleAuthProvider();
    
    // Detect mobile device to switch between popup and redirect auth flows
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (isMobile) {
        auth.signInWithRedirect(provider).catch(error => {
            console.error("Google login redirect failed:", error);
            showToast("❌ Sign-in failed: " + error.message, "error");
        });
    } else {
        auth.signInWithPopup(provider).catch(error => {
            console.error("Google login failed:", error);
            showToast("❌ Sign-in failed: " + error.message, "error");
        });
    }
}

function logout() {
    if (!isFirebaseEnabled) return;
    auth.signOut().then(() => {
        showToast("🚪 Signed out successfully");
    }).catch(error => {
        console.error("Sign-out failed:", error);
    });
}

async function selectWorkspaceRole(role) {
    if (!state.user) return;

    const newProfile = {
        uid: state.user.uid,
        email: state.user.email.toLowerCase(),
        displayName: state.user.displayName || state.user.email,
        photoURL: state.user.photoURL || '',
        role: role,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        await db.collection('users').doc(state.user.uid).set(newProfile);
        state.userProfile = newProfile;
        document.getElementById('onboardingOverlay').style.display = 'none';
        completeUserLogin();
        showToast("✅ Welcome to TealTask!");
    } catch (error) {
        console.error("Onboarding failed:", error);
        showToast("❌ Setup failed. Try again.", "error");
    }
}

function completeUserLogin() {
    const avatarEl = document.getElementById('userAvatar');
    const nameEl = document.getElementById('userDisplayName');
    const badgeEl = document.getElementById('userRoleBadge');

    if (state.userProfile.photoURL) {
        avatarEl.innerHTML = `<img src="${state.userProfile.photoURL}" alt="${state.userProfile.displayName}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
    } else {
        avatarEl.innerText = state.userProfile.displayName.substring(0, 2).toUpperCase();
    }
    
    nameEl.innerText = state.userProfile.displayName;
    
    const role = state.userProfile.role;
    if (role === 'owner') {
        badgeEl.innerText = "Business Owner";
        badgeEl.className = "status-online";
        document.getElementById('teamSection').style.display = 'block';
    } else if (role === 'employee') {
        badgeEl.innerText = "Employee Space";
        badgeEl.className = "status-online";
        document.getElementById('teamSection').style.display = 'none';
    } else {
        badgeEl.innerText = "Personal Account";
        badgeEl.className = "status-online";
        document.getElementById('teamSection').style.display = 'none';
    }

    setupRealtimeSync();
}

function setupRealtimeSync() {
    if (tasksListenerUnsubscribe) { tasksListenerUnsubscribe(); tasksListenerUnsubscribe = null; }
    if (teamListenerUnsubscribe) { teamListenerUnsubscribe(); teamListenerUnsubscribe = null; }

    const role = state.userProfile.role;

    if (role === 'owner') {
        teamListenerUnsubscribe = db.collection('users')
            .where('ownerUid', '==', state.user.uid)
            .onSnapshot(snapshot => {
                state.teamMembers = [];
                snapshot.forEach(doc => {
                    state.teamMembers.push(doc.data());
                });
                renderTeamList();
            }, error => {
                console.error("Team sync error:", error);
            });
    }

    bindTasksListener();
}

function bindTasksListener() {
    if (tasksListenerUnsubscribe) { tasksListenerUnsubscribe(); tasksListenerUnsubscribe = null; }
    
    let tasksQuery = db.collection('tasks');
    const activeTag = state.filters.tag;
    const role = state.userProfile.role;
    
    if (role === 'owner' && activeTag && activeTag.startsWith('employee_')) {
        const employeeUid = activeTag.replace('employee_', '');
        tasksQuery = tasksQuery.where('uid', '==', employeeUid);
    } else {
        tasksQuery = tasksQuery.where('uid', '==', state.user.uid);
    }

    tasksListenerUnsubscribe = tasksQuery
        .onSnapshot(snapshot => {
            state.tasks = [];
            snapshot.forEach(doc => {
                state.tasks.push({ id: doc.id, ...doc.data() });
            });
            // Sort tasks by timestamp in-memory to prevent requiring composite database indexes
            state.tasks.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            renderChatList();
            renderTasks();
            renderChecklistPanel();
            setTimeout(scrollToBottom, 50);
        }, error => {
            console.error("Tasks sync query error:", error);
        });
}

function renderTeamList() {
    const teamList = document.getElementById('teamList');
    if (state.teamMembers.length === 0) {
        teamList.innerHTML = `<div style="padding: 12px 16px; font-size:12px; color:var(--text-secondary); text-align:center;">No team members yet. Invite someone using the "+" button above!</div>`;
        return;
    }

    teamList.innerHTML = state.teamMembers.map(member => {
        const isActive = state.filters.tag === `employee_${member.uid}`;
        const avatarHtml = member.photoURL 
            ? `<img src="${member.photoURL}" alt="${member.displayName}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`
            : `<div class="avatar" style="background-color: var(--teal-primary); color: #fff; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 50%; font-weight: 600;">${member.displayName.substring(0, 2).toUpperCase()}</div>`;
        
        return `
            <div class="chat-item ${isActive ? 'active' : ''}" onclick="selectEmployeeCategory('${member.uid}')" style="display: flex; align-items: center; padding: 10px 16px; cursor: pointer; border-bottom: 1px solid var(--border-light); transition: background-color 0.2s;">
                <div style="width: 40px; height: 40px; margin-right: 12px; position: relative;">
                    ${avatarHtml}
                </div>
                <div class="chat-item-details" style="flex: 1; min-width: 0;">
                    <div class="chat-item-header" style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 3px;">
                        <h3 style="font-size: 14.5px; font-weight: 550; color: var(--text-primary); margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${member.displayName}</h3>
                    </div>
                    <p style="font-size: 12px; color: var(--text-secondary); margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${member.email}</p>
                </div>
            </div>
        `;
    }).join('');
}

window.selectEmployeeCategory = function(employeeUid) {
    state.filters.tag = `employee_${employeeUid}`;
    const employee = state.teamMembers.find(m => m.uid === employeeUid);
    state.activeEmployee = employee;

    if (window.innerWidth <= 992) {
        switchMobileTab('stream');
    }

    bindTasksListener();
    
    document.body.classList.add('chat-view-active');
    setTimeout(scrollToBottom, 50);
};

async function submitEmployeeAccount() {
    const nameInput = document.getElementById('inviteNameInput');
    const emailInput = document.getElementById('inviteEmailInput');
    const passwordInput = document.getElementById('invitePasswordInput');

    const name = nameInput.value.trim();
    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value.trim();
    
    if (!name || !email || !password) {
        showToast("❌ Please fill in all fields.", "error");
        return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showToast("❌ Please enter a valid email.", "error");
        return;
    }

    if (password.length < 6) {
        showToast("❌ Password must be at least 6 characters.", "error");
        return;
    }

    try {
        // Register in the pending_employees queue for first-time login activation
        await db.collection('pending_employees').doc(email).set({
            email: email,
            password: password,
            displayName: name,
            ownerUid: state.user.uid,
            role: 'employee',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        document.getElementById('inviteModal').classList.remove('open');
        showToast(`✅ Created employee account: ${email}`, "success");
    } catch (error) {
        console.error("Failed to register employee credentials:", error);
        showToast("❌ Failed to create account.", "error");
    }
}

async function handleEmployeeLogin() {
    if (!isFirebaseEnabled) return;
    
    const emailInput = document.getElementById('empEmail');
    const passwordInput = document.getElementById('empPassword');
    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value.trim();
    
    if (!email || !password) {
        showToast("❌ Please fill in all fields.", "error");
        return;
    }
    
    const submitBtn = document.getElementById('employeeLoginSubmitBtn');
    const originalBtnText = submitBtn.innerText;
    submitBtn.innerText = "Signing in...";
    submitBtn.disabled = true;

    try {
        // 1. Check if this employee is in the pending_employees registration queue
        const pendingDoc = await db.collection('pending_employees').doc(email).get();
        
        if (pendingDoc.exists) {
            const data = pendingDoc.data();
            if (data.password === password) {
                // First-time login: create the Firebase Auth account
                const userCredential = await auth.createUserWithEmailAndPassword(email, password);
                const user = userCredential.user;
                
                // Create user profile in Firestore
                const newProfile = {
                    uid: user.uid,
                    email: email,
                    displayName: data.displayName,
                    photoURL: '',
                    role: 'employee',
                    ownerUid: data.ownerUid,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                
                await db.collection('users').doc(user.uid).set(newProfile);
                
                // Clean up the pending employee record
                await db.collection('pending_employees').doc(email).delete();
                
                showToast("🎉 Workspace account registered successfully!", "success");
            } else {
                showToast("❌ Incorrect password.", "error");
                submitBtn.innerText = originalBtnText;
                submitBtn.disabled = false;
                return;
            }
        } else {
            // 2. Already registered: standard sign-in
            await auth.signInWithEmailAndPassword(email, password);
            showToast("👋 Welcome back!", "success");
        }
    } catch (error) {
        console.error("Employee login failed:", error);
        showToast("❌ Authentication failed: " + error.message, "error");
    } finally {
        submitBtn.innerText = originalBtnText;
        submitBtn.disabled = false;
    }
}

async function clearCurrentWorkspaceTasks() {
    if (isFirebaseEnabled) {
        const activeTag = state.filters.tag;
        let query = db.collection('tasks');
        
        if (activeTag && activeTag.startsWith('employee_')) {
            const employeeUid = activeTag.replace('employee_', '');
            query = query.where('uid', '==', employeeUid);
        } else {
            query = query.where('uid', '==', state.user.uid);
        }

        try {
            const snapshot = await query.get();
            const batch = db.batch();
            snapshot.forEach(doc => {
                batch.delete(doc.ref);
            });
            await batch.commit();
            showToast("🧹 Space cleared");
        } catch (error) {
            console.error("Failed to clear tasks:", error);
            showToast("❌ Failed to clear tasks.", "error");
        }
    } else {
        state.tasks = [];
        saveTasks();
        renderChatList();
        renderTasks();
        renderChecklistPanel();
        showToast("🧹 Space cleared");
    }
}
