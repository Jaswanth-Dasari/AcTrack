// DOM Elements
const addTaskBtn = document.querySelector('.add-task-btn');
const modal = document.getElementById('add-task-modal');
const closeModalBtn = document.querySelector('.close-modal');
const playButton = document.querySelector('.play-button');
const timerDisplay = document.querySelector('.timer-display');
const elapsedTime = document.querySelector('.elapsed-time');
const completeTaskBtn = document.querySelector('.complete-task-btn');
const projectSelect = document.getElementById('project');
const projectInfo = document.querySelector('.project-info');

// State
let isTracking = false;
let elapsedSeconds = 0;
let timerInterval;
let totalHoursInterval;
let selectedTask = null;
let currentProject = null;
let allTasks = [];
let filteredTasks = [];
let currentPage = 1;
const tasksPerPage = 10;
let isTimerRunning = false;
let timerStartTime = 0;
let lastUpdateTime = 0;

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    if (!window.auth.isAuthenticated()) {
        window.location.href = '/login.html';
        return;
    }
    initializeDashboard();
    setupEventListeners();
    setupSearch();
    setupRecurringTaskFields();
    startTotalHoursUpdate();
});

function initializeDashboard() {
    // Load initial data
    loadUserStats();
    loadTasks();
    loadProjects();
    updateDailyTime();
    
    // Show "no task selected" state by default
    selectTask(null);
    
    // Start updating daily time every minute
    dailyUpdateInterval = setInterval(updateDailyTime, 60000);
}

// Add this new function to calculate total hours for today
async function updateTotalHoursToday() {
    try {
        const userId = window.auth.getUserId();
        if (!userId) {
            throw new Error('User ID not found');
        }

        const response = await fetch(`${config.API_BASE_URL}/api/daily-time/${userId}`, {
            headers: {
                'Authorization': `Bearer ${window.auth.getToken()}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to load daily time');
        }

        const dailyTime = await response.json();
        let totalSecondsToday = dailyTime.totalSeconds || 0;

        // Add current tracking session if active
        if (isTracking && timerStartTime) {
            const currentElapsed = Math.floor((Date.now() - timerStartTime) / 1000);
            totalSecondsToday += currentElapsed;
        }

        // Convert total seconds to HH:MM:SS format
        const hours = Math.floor(totalSecondsToday / 3600);
        const minutes = Math.floor((totalSecondsToday % 3600) / 60);
        const seconds = totalSecondsToday % 60;

        // Update the display
        timerDisplay.textContent = formatTime(hours, minutes, seconds);

    } catch (error) {
        console.error('Error updating total hours today:', error);
        timerDisplay.textContent = '00:00:00';
    }
}

// Function to start updating total hours
function startTotalHoursUpdate() {
    // Update immediately
    updateTotalHoursToday();
    // Then update every minute
    totalHoursInterval = setInterval(updateTotalHoursToday, 60000);
}

// Clean up interval on page unload
window.addEventListener('beforeunload', () => {
    if (totalHoursInterval) {
        clearInterval(totalHoursInterval);
    }
    if (isTracking) {
        stopTimer();
    }
});

function setupEventListeners() {
    // Modal controls
    addTaskBtn.addEventListener('click', openModal);
    closeModalBtn.addEventListener('click', closeModal);
    
    // Timer controls
    playButton.addEventListener('click', toggleTimer);
    completeTaskBtn.addEventListener('click', completeTask);
    
    // Form submission
    document.getElementById('add-task-form').addEventListener('submit', handleTaskSubmit);

    // Project selection
    projectSelect.addEventListener('change', handleProjectChange);

    // Recurring task fields
    setupRecurringTaskFields();
}

// Project Functions
async function loadProjects() {
    try {
        const response = await fetch('https://actracker.onrender.com/projects', {
            headers: {
                'Authorization': `Bearer ${window.auth.getToken()}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to load projects');
        }

        const projects = await response.json();
        populateProjectSelect(projects);
    } catch (error) {
        console.error('Error loading projects:', error);
    }
}

function populateProjectSelect(projects) {
    // Clear existing options except the default one
    projectSelect.innerHTML = '<option value="">Select project</option>';
    
    // Add projects to select dropdown
    projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project._id;
        option.textContent = project.projectName;
        projectSelect.appendChild(option);
    });

    // If there was a previously selected project, restore it
    if (currentProject) {
        projectSelect.value = currentProject._id;
    }
}

function handleProjectChange(e) {
    const selectedProjectId = e.target.value;
    const selectedProject = Array.from(e.target.options).find(option => option.value === selectedProjectId);
    
    if (selectedProjectId && selectedProject) {
        currentProject = {
            _id: selectedProjectId,
            projectName: selectedProject.textContent
        };
        
        // Update project info display
        projectInfo.innerHTML = `
            <p class="project-name">${selectedProject.textContent}</p>
            <p class="no-task">No Task Selected</p>
        `;
    } else {
        currentProject = null;
        projectInfo.innerHTML = `
            <p class="no-project">No Project Selected</p>
            <p class="no-task">No Task Selected</p>
        `;
    }

    // If tracking is active, update the current session
    if (isTracking) {
        updateTrackingSession();
    }
}

async function updateTrackingSession() {
    if (!currentProject) return;

    try {
        const userId = window.auth.getUserId();
        
        // Pause current tracking
        await window.electronAPI.pauseTrackingBrowserActivity();
        
        // Resume with new project
        await window.electronAPI.startTrackingBrowserActivity(userId, currentProject._id);
    } catch (error) {
        console.error('Error updating tracking session:', error);
    }
}

// Modal Functions
function openModal() {
    modal.classList.add('active');
}

function closeModal() {
    modal.classList.remove('active');
}

// Timer Functions
function toggleTimer() {
    if (!selectedTask) {
        displayNotification('Please select a task first', 'error');
        return;
    }

    if (!isTracking) {
        startTimer();
    } else {
        stopTimer();
    }
}

async function startTimer() {
    if (!selectedTask) {
        displayNotification('Please select a task first', 'error');
        return;
    }

    try {
        const userId = window.auth.getUserId();
        if (!userId) {
            throw new Error('User ID not found');
        }

        // Set timer start time and last update time
        timerStartTime = Date.now();
        lastUpdateTime = timerStartTime;
        isTracking = true;
        
        // Update UI
        playButton.innerHTML = '<i class="fas fa-stop"></i>';
        
        // Ensure we have all required fields from the selected task
        if (!selectedTask.project?.projectId || !selectedTask.taskId) {
            throw new Error('Missing required task information');
        }

        // Start activity tracking with task information
        const trackingResult = await window.electronAPI.startTrackingBrowserActivity(
            userId,
            selectedTask.project.projectId,
            selectedTask.taskId, // Ensure taskId is passed
            selectedTask.title
        );

        if (trackingResult && trackingResult.error) {
            throw new Error(trackingResult.error);
        }

        // Update task status if needed
        if (selectedTask.status === 'Not Started') {
            const taskResponse = await fetch(`${config.API_BASE_URL}/api/tasks/${selectedTask.taskId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${window.auth.getToken()}`
                },
                body: JSON.stringify({
                    status: 'In Progress'
                })
            });

            if (taskResponse.ok) {
                selectedTask.status = 'In Progress';
                const taskIndex = allTasks.findIndex(t => t.taskId === selectedTask.taskId);
                if (taskIndex !== -1) {
                    allTasks[taskIndex].status = 'In Progress';
                    const filteredIndex = filteredTasks.findIndex(t => t.taskId === selectedTask.taskId);
                    if (filteredIndex !== -1) {
                        filteredTasks[filteredIndex].status = 'In Progress';
                    }
                    renderTasks(filteredTasks.length ? filteredTasks : allTasks);
                }
            }
        }

        // Start timer update
        timerInterval = setInterval(updateTimer, 1000);
        
        // Setup activity tracking
        document.addEventListener('mousemove', handleMouseActivity);
        document.addEventListener('click', handleMouseActivity);
        document.addEventListener('wheel', handleMouseActivity);
        document.addEventListener('keydown', handleKeyboardActivity);
        
    } catch (error) {
        console.error('Error starting timer:', error);
        displayNotification('Failed to start timer: ' + error.message, 'error');
        isTracking = false;
        playButton.innerHTML = '<i class="fas fa-play"></i>';
    }
}

async function stopTimer() {
    if (!isTracking || !selectedTask) return;
    
    try {
        const userId = window.auth.getUserId();
        const projectId = selectedTask.project.projectId;
        
        clearInterval(timerInterval);
        
        await window.electronAPI.stopTrackingBrowserActivity(userId, projectId, elapsedSeconds);
        
        // Parse existing time logged
        let existingHours = 0;
        let existingMinutes = 0;
        if (selectedTask.timing?.timeLogged) {
            const timeMatch = selectedTask.timing.timeLogged.match(/(\d+)h\s*(\d+)m/);
            if (timeMatch) {
                existingHours = parseInt(timeMatch[1]) || 0;
                existingMinutes = parseInt(timeMatch[2]) || 0;
            }
        }

        // Add new elapsed time to existing time
        const newSeconds = elapsedSeconds + (existingHours * 3600) + (existingMinutes * 60);
        const totalHours = Math.floor(newSeconds / 3600);
        const totalMinutes = Math.floor((newSeconds % 3600) / 60);
        const timeLogged = `${totalHours}h ${totalMinutes}m`;
        
        // Calculate new worked hours
        const existingWorked = selectedTask.timing?.worked || 0;
        const newWorkedHours = existingWorked + (elapsedSeconds / 3600);
        
        // Update task in database
        const taskResponse = await fetch(`${config.API_BASE_URL}/api/tasks/${selectedTask.taskId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.auth.getToken()}`
            },
            body: JSON.stringify({
                userId: userId,
                timing: {
                    startDate: selectedTask.timing?.startDate,
                    dueDate: selectedTask.timing?.dueDate,
                    estimate: selectedTask.timing?.estimate,
                    worked: newWorkedHours,
                    timeLogged: timeLogged
                }
            })
        });

        if (!taskResponse.ok) {
            throw new Error('Failed to update task time');
        }

        // Update daily time
        await updateDailyTime(
            selectedTask.taskId,
            elapsedSeconds,
            selectedTask.title,
            selectedTask.project.projectName
        );
        
        // Update local task data
        selectedTask.timing = {
            ...selectedTask.timing,
            timeLogged: timeLogged,
            worked: newWorkedHours
        };
        
        // Update task in arrays and re-render
        const taskIndex = allTasks.findIndex(t => t.taskId === selectedTask.taskId);
        if (taskIndex !== -1) {
            allTasks[taskIndex] = {...selectedTask};
            const filteredIndex = filteredTasks.findIndex(t => t.taskId === selectedTask.taskId);
            if (filteredIndex !== -1) {
                filteredTasks[filteredIndex] = {...selectedTask};
            }
            renderTasks(filteredTasks.length ? filteredTasks : allTasks);
        }
        
        // Reset timer state
        elapsedSeconds = 0;
        elapsedTime.textContent = '00:00:00';
        isTracking = false;
        playButton.innerHTML = '<i class="fas fa-play"></i>';
        
        // Remove event listeners
        document.removeEventListener('mousemove', handleMouseActivity);
        document.removeEventListener('click', handleMouseActivity);
        document.removeEventListener('wheel', handleMouseActivity);
        document.removeEventListener('keydown', handleKeyboardActivity);
        
        await loadUserStats();
        displayNotification('Timer stopped successfully', 'success');
        
    } catch (error) {
        console.error('Error stopping timer:', error);
        displayNotification('Failed to stop timer: ' + error.message, 'error');
        
        clearInterval(timerInterval);
        elapsedSeconds = 0;
        elapsedTime.textContent = '00:00:00';
        isTracking = false;
        playButton.innerHTML = '<i class="fas fa-play"></i>';
    }
}

function updateTimer() {
    if (!isTracking || !timerStartTime) return;
    
    const now = Date.now();
    elapsedSeconds = Math.floor((now - timerStartTime) / 1000);
    
    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const seconds = elapsedSeconds % 60;
    
    elapsedTime.textContent = formatTime(hours, minutes, seconds);
    
    // Update total hours today as well
    updateTotalHoursToday();
}

function formatTime(hours, minutes, seconds) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Task Functions
async function handleTaskSubmit(e) {
    e.preventDefault();
    
    try {
        clearMessages();
        
        // Basic validation
        const requiredFields = ['task-title', 'project', 'startDate', 'dueDate', 'task-status'];
        let hasErrors = false;
        
        requiredFields.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (!field.value.trim()) {
                highlightField(fieldId);
                hasErrors = true;
            }
        });
        
        // Validate recurring task fields if enabled
        const isRecurring = document.getElementById('recurring-toggle').checked;
        if (isRecurring) {
            const untilDate = document.getElementById('until-date').value;
            const selectedDays = document.querySelectorAll('input[name="days"]:checked');
            
            if (!untilDate) {
                highlightField('until-date');
                hasErrors = true;
            }
            
            if (selectedDays.length === 0) {
                displayNotification('Please select at least one day for recurring task', 'error');
                hasErrors = true;
            }
        }
        
        if (hasErrors) {
            displayNotification('Please fill in all required fields', 'error');
            return;
        }
        
        const formData = new FormData(e.target);
        const userId = window.auth.getUserId();
        
        // Get selected days only if recurring is enabled
        const selectedDays = isRecurring ? 
            Array.from(document.querySelectorAll('input[name="days"]:checked'))
                .map(checkbox => checkbox.value) : [];
        
        // Store values that should be kept for Save & Add Another
        const projectValue = formData.get('project');
        const sprintValue = formData.get('sprint');
        const epicValue = formData.get('epic');
        
        // Get project name from select element
        const projectSelect = document.getElementById('project');
        const selectedProjectName = projectSelect.options[projectSelect.selectedIndex]?.text || 'No Project';

        // Get sprint and epic names from select elements
        const sprintSelect = document.getElementById('sprint');
        const epicSelect = document.getElementById('epic');
        const selectedSprintName = sprintSelect.options[sprintSelect.selectedIndex]?.text || '';
        const selectedEpicName = epicSelect.options[epicSelect.selectedIndex]?.text || '';

        // Parse dates and ensure they're in ISO format
        const startDate = formData.get('startDate') ? new Date(formData.get('startDate')).toISOString() : null;
        const dueDate = formData.get('dueDate') ? new Date(formData.get('dueDate')).toISOString() : null;
        const untilDate = isRecurring && formData.get('until-date') ? 
            new Date(formData.get('until-date')).toISOString() : null;

        // Parse numeric values
        const estimate = formData.get('estimate') ? Number(formData.get('estimate')) : 0;
        const worked = formData.get('worked') ? Number(formData.get('worked')) : 0;
        
        // Create task schema
        const taskData = {
            taskId: `task_${Date.now()}`,
            userId: userId,
            projectId: projectValue || null,
            title: formData.get('task-title') || null,
            description: formData.get('description') || null,
            status: formData.get('task-status') || 'Not Started',
            priority: 'High',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            metadata: {
                sprint: sprintValue || null,
                sprintName: selectedSprintName,
                epic: epicValue || null,
                epicName: selectedEpicName,
                labels: [],
                dependencies: [],
                attachments: []
            },
            timing: {
                startDate: startDate,
                dueDate: dueDate,
                estimate: estimate,
                worked: worked,
                timeLogged: '0 Hours'
            },
            recurring: {
                isRecurring: isRecurring,
                untilDate: untilDate,
                days: selectedDays
            },
            assignee: {
                userId: formData.get('assignee') || userId,
                assignedAt: new Date().toISOString()
            },
            project: {
                projectId: projectValue || null,
                projectName: selectedProjectName
            }
        };

        console.log('Sending task data:', taskData);

        const response = await fetch('https://actracker.onrender.com/api/tasks/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.auth.getToken()}`
            },
            body: JSON.stringify(taskData)
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || data.error || 'Failed to create task');
        }
        
        displayNotification('Task created successfully!', 'success');
        await loadTasks();

        // Handle Save & Add Another
        const submitButton = e.submitter;
        const isSaveAndAdd = submitButton.value === 'saveAndAdd';
        
        if (isSaveAndAdd) {
            e.target.reset();
            if (projectValue) document.getElementById('project').value = projectValue;
            if (sprintValue) document.getElementById('sprint').value = sprintValue;
            if (epicValue) document.getElementById('epic').value = epicValue;
            document.getElementById('task-title').focus();
        } else {
            e.target.reset();
            closeModal();
        }
        
    } catch (error) {
        displayNotification(error.message || 'Failed to create task. Please try again.', 'error');
    }
}

function createNotificationContainer() {
    let container = document.querySelector('.notification-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'notification-container';
        document.body.appendChild(container);
    }
    return container;
}

function displayNotification(message, type = 'info') {
    const container = createNotificationContainer();
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    
    // Add icon based on type
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-icon">${icon}</span>
            <span class="notification-message">${message}</span>
        </div>
        <button class="notification-close">✕</button>
    `;
    
    // Add to container
    container.appendChild(notification);
    
    // Add close button functionality
    const closeBtn = notification.querySelector('.notification-close');
    closeBtn.onclick = () => {
        notification.classList.add('notification-hiding');
        setTimeout(() => notification.remove(), 300);
    };
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        if (notification.parentElement) {
            notification.classList.add('notification-hiding');
            setTimeout(() => notification.remove(), 300);
        }
    }, 5000);
}

// Add notification styles immediately when the script loads
const notificationStyles = `
    .notification-container {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
    }

    .notification {
        background: white;
        border-radius: 8px;
        padding: 16px;
        min-width: 300px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        animation: slideIn 0.3s ease-out;
        pointer-events: auto;
    }

    .notification-content {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .notification-icon {
        font-size: 20px;
    }

    .notification-message {
        font-size: 14px;
        font-weight: 500;
        color: #333;
    }

    .notification-close {
        background: none;
        border: none;
        cursor: pointer;
        padding: 4px;
        opacity: 0.6;
        transition: opacity 0.2s;
        color: #333;
    }

    .notification-close:hover {
        opacity: 1;
    }

    .notification-success {
        border-left: 4px solid #48BB78;
    }

    .notification-error {
        border-left: 4px solid #F56565;
    }

    .notification-info {
        border-left: 4px solid #4299E1;
    }

    .notification-success .notification-icon {
        color: #48BB78;
    }

    .notification-error .notification-icon {
        color: #F56565;
    }

    .notification-info .notification-icon {
        color: #4299E1;
    }

    .notification-hiding {
        animation: slideOut 0.3s ease-in forwards;
    }

    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }

    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;

// Add styles to document immediately
(function() {
    const styleElement = document.createElement('style');
    styleElement.textContent = notificationStyles;
    document.head.appendChild(styleElement);
})();

function clearFormErrors() {
    // Remove error classes from all form fields
    document.querySelectorAll('.form-group').forEach(group => {
        group.classList.remove('has-error');
        const errorMessage = group.querySelector('.error-message');
        if (errorMessage) {
            errorMessage.remove();
        }
    });
}

function highlightField(fieldName) {
    const field = document.getElementById(fieldName);
    if (!field) return;
    
    const formGroup = field.closest('.form-group');
    if (!formGroup) return;
    
    formGroup.classList.add('has-error');
    
    // Add error message
    const errorMessage = document.createElement('div');
    errorMessage.className = 'error-message';
    errorMessage.textContent = 'This field is required';
    formGroup.appendChild(errorMessage);
}

// Add the validation styles to the document
const validationStyles = `
    .form-group.has-error input,
    .form-group.has-error select,
    .form-group.has-error textarea {
        border-color: var(--danger-color);
        background-color: rgba(255, 118, 117, 0.1);
    }
    
    .error-message {
        color: var(--danger-color);
        font-size: 0.8em;
        margin-top: 4px;
        animation: fadeIn 0.3s ease-in;
    }
    
    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(-5px); }
        to { opacity: 1; transform: translateY(0); }
    }
    
    /* Add required field indicator */
    .form-group.required label::after {
        content: "*";
        color: var(--danger-color);
        margin-left: 4px;
    }
`;

// Create and append the validation styles
const validationStyleElement = document.createElement('style');
validationStyleElement.textContent = validationStyles;
document.head.appendChild(validationStyleElement);

// Add required class to required form groups
document.addEventListener('DOMContentLoaded', () => {
    // Add required indicators
    const requiredFields = ['task-title', 'project', 'due-date'];
    requiredFields.forEach(fieldId => {
        const formGroup = document.getElementById(fieldId)?.closest('.form-group');
        if (formGroup) {
            formGroup.classList.add('required');
        }
    });
});

async function loadTasks() {
    try {
        const userId = window.auth.getUserId();
        const response = await fetch(`https://actracker.onrender.com/api/tasks/${userId}`, {
            headers: {
                'Authorization': `Bearer ${window.auth.getToken()}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to load tasks');
        }
        
        allTasks = await response.json();
        filteredTasks = [...allTasks];
        renderTasks(filteredTasks);
        
        // Update total tasks count in stats
        document.querySelector('.stat-card:nth-child(4) p').textContent = allTasks.length;
        
    } catch (error) {
        console.error('Error loading tasks:', error);
        displayNotification('Failed to load tasks', 'error');
    }
}

// Add this function to calculate priority based on deadline
function calculatePriority(dueDate) {
    if (!dueDate) return 'Low';
    
    const today = new Date();
    const deadline = new Date(dueDate);
    const daysUntilDue = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
    
    if (daysUntilDue < 0) return 'Overdue';
    if (daysUntilDue <= 2) return 'High';
    if (daysUntilDue <= 7) return 'Medium';
    return 'Low';
}

function renderTasks(tasks) {
    const tableBody = document.querySelector('.table-body');
    const emptyState = document.querySelector('.empty-state');
    
    if (!tableBody) {
        console.error('Table body element not found');
        return;
    }
    
    if (!tasks || tasks.length === 0) {
        tableBody.innerHTML = '';
        if (emptyState) {
            emptyState.style.display = 'flex';
        }
        return;
    }
    
    if (emptyState) {
        emptyState.style.display = 'none';
    }
    
    const startIndex = (currentPage - 1) * tasksPerPage;
    const endIndex = startIndex + tasksPerPage;
    const paginatedTasks = tasks.slice(startIndex, endIndex);
    
    tableBody.innerHTML = paginatedTasks.map(task => {
        let timeLogged = '0h 0m';
        if (task.timing && task.timing.timeLogged) {
            timeLogged = task.timing.timeLogged;
        }

        const isSelected = selectedTask && selectedTask.taskId === task.taskId;
        return `
            <div class="task-row ${isSelected ? 'selected' : ''}" data-task-id="${task.taskId}" onclick="selectTask(${JSON.stringify(task).replace(/"/g, '&quot;')})">
                <div class="task-title">${task.title || 'Untitled Task'}</div>
                <div class="project-name">${task.project?.projectName || 'No Project'}</div>
                <div class="deadline">${formatDate(task.timing?.dueDate)}</div>
                <div class="priority">
                    <span class="priority-badge priority-${task.priority?.toLowerCase()}">${task.priority || 'Low'}</span>
                </div>
                <div class="time-logged">${timeLogged}</div>
                <div class="status">
                    <span class="status-badge ${getStatusClass(task.status)}">${task.status || 'Not Started'}</span>
                </div>
            </div>
        `;
    }).join('');
    
    updatePagination(tasks.length);
}

function getStatusClass(status) {
    const statusMap = {
        'Completed': 'status-completed',
        'Not Started': 'status-not-started',
        'In Progress': 'status-in-progress',
        'Blocked': 'status-blocked'
    };
    return statusMap[status] || 'status-not-started';
}

function selectTask(task) {
    selectedTask = task;
    
    if (!task) {
        projectInfo.innerHTML = `
            <div class="no-task-container">
                <svg width="173" height="144" viewBox="0 0 173 144" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <!-- SVG path data -->
                </svg>
                <p class="no-task">No Task Selected!</p>
                <p class="no-task-message">Please select task to start track ur time</p>
            </div>
        `;
        return;
    }
    
    const formattedDate = task.timing?.dueDate ? formatDate(task.timing.dueDate) : 'No date';
    
    projectInfo.innerHTML = `
        <div class="selected-task-info">
            <p class="project-name">${task.project?.projectName || 'No Project'}</p>
            <p class="task-name">${task.title}</p>
            <div class="task-meta">
                <span class="due-date">Due Time: ${formattedDate}</span>
                <span class="priority">Priority: ${task.priority}</span>
                <span class="status">Status: ${task.status}</span>
            </div>
            <div class="task-details">
                <p class="assigned-by">Assigned to: ${task.assignee?.userId}</p>
                <p class="task-description">${task.description || 'No description'}</p>
            </div>
        </div>
    `;

    // If timer is running for a different task, stop it
    if (isTracking) {
        stopTimer();
    }
}

async function loadUserStats() {
    try {
        const userId = window.auth.getUserId();
        
        // Fetch all daily time entries for the user
        const response = await fetch(`https://actracker.onrender.com/api/daily-time/all/${userId}`, {
            headers: {
                'Authorization': `Bearer ${window.auth.getToken()}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to load user stats');
        }
        
        const dailyTimes = await response.json();
        
        // Calculate total seconds from all daily time entries
        const totalSeconds = dailyTimes.reduce((total, entry) => total + entry.totalSeconds, 0);
        
        // Convert total seconds to hours, minutes, seconds
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        
        // Format the time string
        const formattedTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        
        // Update the stats display
        document.querySelector('.stat-card:nth-child(1) p').textContent = formattedTime;
        
        // Calculate earnings if hourly rate is available
        const hourlyRate = 20; // You can make this dynamic based on user settings
        const totalHours = totalSeconds / 3600;
        const totalEarned = totalHours * hourlyRate;
        
        document.querySelector('.stat-card:nth-child(2) p').textContent = `$${totalEarned.toFixed(2)}`;
        document.querySelector('.stat-card:nth-child(3) p').textContent = `$${hourlyRate.toFixed(2)}`;
        document.querySelector('.stat-card:nth-child(4) p').textContent = allTasks.length;
        
    } catch (error) {
        console.error('Error loading user stats:', error);
        displayNotification('Failed to load user statistics', 'error');
    }
}

function formatDate(dateString) {
    if (!dateString) return 'No date';
    const date = new Date(dateString);
    return date.toLocaleDateString();
}

function getCurrentProjectId() {
    return currentProject?._id || null;
}

async function completeTask() {
    if (!isTracking || !selectedTask) return;
    
    try {
        const userId = window.auth.getUserId();
        const token = window.auth.getToken();
        const projectId = selectedTask.project.projectId;
        
        // First stop the timer interval
        clearInterval(timerInterval);
        
        // Stop tracking in electron
        await window.electronAPI.stopTrackingBrowserActivity(userId, projectId, elapsedSeconds);
        
        // Update daily time in the database
        await updateDailyTime(
            selectedTask.taskId,
            elapsedSeconds,
            selectedTask.title,
            selectedTask.project.projectName
        );
        
        // Update task status to completed
        const taskResponse = await fetch(`${config.API_BASE_URL}/api/tasks/${selectedTask.taskId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                userId: userId,
                status: 'Completed',
                updatedAt: new Date().toISOString(),
                timing: {
                    ...selectedTask.timing,
                    worked: ((selectedTask.timing?.worked || 0) + (elapsedSeconds / 3600)).toFixed(2)
                }
            })
        });

        if (!taskResponse.ok) {
            const errorData = await taskResponse.text();
            let errorMessage = 'Failed to update task status';
            try {
                const parsedError = JSON.parse(errorData);
                errorMessage = parsedError.error || errorMessage;
            } catch (e) {
                // If JSON parsing fails, use the raw error text if it's not HTML
                if (!errorData.includes('<!DOCTYPE html>')) {
                    errorMessage = errorData;
                }
            }
            throw new Error(errorMessage);
        }

        // Reset timer state
        elapsedSeconds = 0;
        elapsedTime.textContent = '00:00:00';
        isTracking = false;
        playButton.innerHTML = '<i class="fas fa-play"></i>';
        
        // Update the task status in the local arrays
        const taskIndex = allTasks.findIndex(task => task.taskId === selectedTask.taskId);
        if (taskIndex !== -1) {
            allTasks[taskIndex].status = 'Completed';
            // Update filtered tasks if they exist
            const filteredIndex = filteredTasks.findIndex(task => task.taskId === selectedTask.taskId);
            if (filteredIndex !== -1) {
                filteredTasks[filteredIndex].status = 'Completed';
            }
        }

        // Update the selected task status
        selectedTask.status = 'Completed';
        
        // Re-render the tasks to show the updated status
        renderTasks(filteredTasks.length ? filteredTasks : allTasks);
        
        // Update the task info display
        selectTask(selectedTask);
        
        // Show completion modal
        showCompletionModal();
        
        // Refresh stats
        await loadUserStats();
        
        displayNotification('Task completed successfully', 'success');
    } catch (error) {
        console.error('Error completing task:', error);
        displayNotification('Failed to complete task: ' + error.message, 'error');
        
        // Reset UI even if there's an error
        clearInterval(timerInterval);
        elapsedSeconds = 0;
        elapsedTime.textContent = '00:00:00';
        isTracking = false;
        playButton.innerHTML = '<i class="fas fa-play"></i>';
    }
}

function showCompletionModal() {
    // Create modal container
    const modalContainer = document.createElement('div');
    modalContainer.className = 'completion-modal';
    
    // Add completion SVG and message
    modalContainer.innerHTML = `
        <div class="completion-content">
            <svg width="165" height="165" viewBox="0 0 165 165" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M136.1 83.9C136.1 98.1 130.3 110.9 121 120.1C111.9 129.2 99.3 134.7 85.4 134.7C71.6 134.7 59 129.1 49.8 120.1C40.5 110.9 34.7 98.1 34.7 83.9C34.7 55.8 57.4 33.1 85.4 33.1C113.4 33.1 136.1 55.9 136.1 83.9Z" fill="#EAEEF9"/>
                <path d="M131.7 50.6C133.964 50.6 135.8 48.7643 135.8 46.5C135.8 44.2356 133.964 42.4 131.7 42.4C129.436 42.4 127.6 44.2356 127.6 46.5C127.6 48.7643 129.436 50.6 131.7 50.6Z" fill="#EAEEF9"/>
                <path d="M137.7 34.6C139.246 34.6 140.5 33.3464 140.5 31.8C140.5 30.2536 139.246 29 137.7 29C136.154 29 134.9 30.2536 134.9 31.8C134.9 33.3464 136.154 34.6 137.7 34.6Z" fill="#EAEEF9"/>
                <path d="M36.3 50.5C37.8464 50.5 39.1 49.2464 39.1 47.7C39.1 46.1536 37.8464 44.9 36.3 44.9C34.7536 44.9 33.5 46.1536 33.5 47.7C33.5 49.2464 34.7536 50.5 36.3 50.5Z" fill="#EAEEF9"/>
                <path d="M19.2 104.5C22.0719 104.5 24.4 102.172 24.4 99.3C24.4 96.4281 22.0719 94.1 19.2 94.1C16.3281 94.1 14 96.4281 14 99.3C14 102.172 16.3281 104.5 19.2 104.5Z" fill="#EAEEF9"/>
                <path d="M121 57.3V120.1C111.9 129.2 99.3 134.7 85.4 134.7C71.6 134.7 59 129.1 49.8 120.1V57.3H121Z" fill="white"/>
                <path opacity="0.5" d="M86.6578 89.3536L72.7279 75.4238L67.9903 80.1613L81.9202 94.0912L86.6578 89.3536Z" fill="#979FAF"/>
                <path opacity="0.5" d="M98.0834 68.4989L77.2946 89.2876L82.0322 94.0252L102.821 73.2365L98.0834 68.4989Z" fill="#979FAF"/>
                <path d="M103.6 102.6H67.2V107.2H103.6V102.6Z" fill="#D5DAE5"/>
                <path d="M103.6 112.7H67.2V117.3H103.6V112.7Z" fill="#D5DAE5"/>
                <path d="M94.7 122.9H76.1V127.5H94.7V122.9Z" fill="#D5DAE5"/>
            </svg>
            <h2>Task Completed!</h2>
            <p>Great job! You've completed the task successfully.</p>
            <button class="continue-button" onclick="closeCompletionModal()">Continue</button>
        </div>
    `;
    
    document.body.appendChild(modalContainer);
    
    // Add animation class after a small delay
    setTimeout(() => {
        modalContainer.classList.add('active');
    }, 50);
}

function closeCompletionModal() {
    const modal = document.querySelector('.completion-modal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => {
            modal.remove();
        }, 300);
    }
}

// Handle window events
window.addEventListener('beforeunload', () => {
    if (isTracking) {
        pauseTimer();
    }
}); 

// Update the styles
const taskStyles = `
    .task-row {
        display: grid;
        grid-template-columns: 2fr 1.5fr 1fr 0.8fr 1fr 1fr;
        padding: 16px;
        border-bottom: 1px solid var(--border-color);
        align-items: center;
        cursor: pointer;
        transition: background-color 0.2s;
    }

    .task-row:hover {
        background-color: var(--hover-color);
    }

    .task-title {
        font-weight: 500;
        color: var(--text-color);
    }

    .project-name {
        color: var(--text-light);
        font-size: 0.9em;
    }

    .priority-badge {
        padding: 4px 12px;
        border-radius: 4px;
        font-size: 0.85em;
        font-weight: 500;
    }

    .priority-high {
        background-color: #FEE2E2;
        color: #DC2626;
    }

    .status-badge {
        padding: 4px 12px;
        border-radius: 4px;
        font-size: 0.85em;
        font-weight: 500;
        text-align: center;
    }

    .status-completed {
        background-color: #D1FAE5;
        color: #059669;
    }

    .status-not-started {
        background-color: #FEE2E2;
        color: #DC2626;
    }

    .status-in-progress {
        background-color: #FEF3C7;
        color: #D97706;
    }

    .status-blocked {
        background-color: #E5E7EB;
        color: #4B5563;
    }

    .selected-task-info {
        padding: 16px;
    }

    .selected-task-info .project-name {
        font-size: 1.1em;
        font-weight: 600;
        margin-bottom: 8px;
    }

    .selected-task-info .task-name {
        font-size: 0.95em;
        color: var(--text-light);
        margin-bottom: 16px;
    }

    .task-meta {
        display: flex;
        gap: 16px;
        margin-bottom: 16px;
        font-size: 0.9em;
        color: var(--text-light);
    }

    .task-details {
        font-size: 0.9em;
        color: var(--text-light);
    }
`;

// Add the styles to the document
const styleElement = document.createElement('style');
styleElement.textContent = taskStyles;
document.head.appendChild(styleElement); 

// Add search functionality
function setupSearch() {
    const searchInput = document.querySelector('.search-bar input');
    if (!searchInput) return;

    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase().trim();
        currentPage = 1; // Reset to first page when searching
        
        if (!searchTerm) {
            filteredTasks = [...allTasks];
        } else {
            filteredTasks = allTasks.filter(task => {
                const titleMatch = task.title?.toLowerCase().includes(searchTerm);
                const projectMatch = task.project?.projectName?.toLowerCase().includes(searchTerm);
                const statusMatch = task.status?.toLowerCase().includes(searchTerm);
                const priorityMatch = task.priority?.toLowerCase().includes(searchTerm);
                
                return titleMatch || projectMatch || statusMatch || priorityMatch;
            });
        }
        
        renderTasks(filteredTasks);
    });
} 

// Add pagination update function
function updatePagination(totalTasks) {
    const totalPages = Math.ceil(totalTasks / tasksPerPage);
    const pagination = document.querySelector('.pagination');
    
    if (totalPages <= 1) {
        pagination.style.display = 'none';
        return;
    }
    
    pagination.style.display = 'flex';
    
    // Calculate visible page numbers
    let pageNumbers = [];
    if (totalPages <= 7) {
        pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);
    } else {
        if (currentPage <= 4) {
            pageNumbers = [1, 2, 3, 4, 5, '...', totalPages];
        } else if (currentPage >= totalPages - 3) {
            pageNumbers = [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
        } else {
            pageNumbers = [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages];
        }
    }
    
    // Generate pagination HTML
    const paginationHTML = `
        <button class="first-page" ${currentPage === 1 ? 'disabled' : ''} title="First Page">
            <i class="fas fa-angle-double-left"></i>
        </button>
        <button class="prev-page" ${currentPage === 1 ? 'disabled' : ''} title="Previous Page">
            <i class="fas fa-angle-left"></i>
        </button>
        <div class="page-numbers">
            ${pageNumbers.map(num => {
                if (num === '...') {
                    return '<span class="ellipsis">...</span>';
                }
                return `<button class="page-number ${num === currentPage ? 'active' : ''}" data-page="${num}">${num}</button>`;
            }).join('')}
        </div>
        <button class="next-page" ${currentPage === totalPages ? 'disabled' : ''} title="Next Page">
            <i class="fas fa-angle-right"></i>
        </button>
        <button class="last-page" ${currentPage === totalPages ? 'disabled' : ''} title="Last Page">
            <i class="fas fa-angle-double-right"></i>
        </button>
    `;
    
    // Remove old event listener if it exists
    const oldPagination = pagination.cloneNode(true);
    pagination.parentNode.replaceChild(oldPagination, pagination);
    
    // Set the new HTML
    oldPagination.innerHTML = paginationHTML;
    
    // Add the new event listener
    oldPagination.addEventListener('click', handlePaginationClick);
}

// Separate function to handle pagination clicks
function handlePaginationClick(e) {
    const target = e.target.closest('button');
    if (!target || target.disabled) return;

    const totalPages = Math.ceil((filteredTasks.length || allTasks.length) / tasksPerPage);
    let newPage = currentPage;

    if (target.classList.contains('first-page')) {
        newPage = 1;
    } else if (target.classList.contains('prev-page')) {
        newPage = Math.max(1, currentPage - 1);
    } else if (target.classList.contains('next-page')) {
        newPage = Math.min(totalPages, currentPage + 1);
    } else if (target.classList.contains('last-page')) {
        newPage = totalPages;
    } else if (target.classList.contains('page-number')) {
        newPage = parseInt(target.dataset.page);
    }

    if (newPage !== currentPage) {
        currentPage = newPage;
        renderTasks(filteredTasks.length ? filteredTasks : allTasks);
    }
}

// Function to update daily time
async function updateDailyTime(taskId, seconds, title, projectName) {
    try {
        const userId = window.auth.getUserId();
        const token = window.auth.getToken();
        
        if (!userId || !token) {
            throw new Error('User not authenticated');
        }

        const today = new Date().toISOString().split('T')[0];

        // First update the daily time
        const response = await fetch('https://actracker.onrender.com/api/daily-time/update', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                userId,
                date: today,
                taskId: taskId || 'default',
                seconds: seconds || 0,
                title: title || 'Untitled Task',
                projectName: projectName || 'Default Project'
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to update daily time');
        }

        // Then update the task's time logged if we have a taskId
        if (taskId) {
            try {
                // Calculate time logged
                const hours = Math.floor(seconds / 3600);
                const minutes = Math.floor((seconds % 3600) / 60);
                const timeLogged = `${hours}h ${minutes}m`;

                const taskResponse = await fetch(`${config.API_BASE_URL}/api/tasks/${taskId}`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        timing: {
                            timeLogged: timeLogged
                        }
                    })
                });

                if (!taskResponse.ok) {
                    throw new Error('Failed to update task time logged');
                }

                // Update local task data if it exists
                const taskIndex = allTasks.findIndex(t => t.taskId === taskId);
                if (taskIndex !== -1) {
                    allTasks[taskIndex].timing = {
                        ...allTasks[taskIndex].timing,
                        timeLogged: timeLogged
                    };

                    // Update filtered tasks if they exist
                    const filteredIndex = filteredTasks.findIndex(t => t.taskId === taskId);
                    if (filteredIndex !== -1) {
                        filteredTasks[filteredIndex].timing = {
                            ...filteredTasks[filteredIndex].timing,
                            timeLogged: timeLogged
                        };
                    }

                    // Only re-render if we have tasks to show
                    if (allTasks.length > 0) {
                        renderTasks(filteredTasks.length ? filteredTasks : allTasks);
                    }
                }
            } catch (error) {
                console.error('Error updating task time:', error);
                // Continue execution even if task update fails
            }
        }

        const data = await response.json();
        console.log('Daily time updated successfully:', data);
        
        await loadUserStats();
        
        return data;
    } catch (error) {
        console.error('Error updating daily time:', error);
        displayNotification('Failed to update time tracking: ' + error.message, 'error');
        throw error;
    }
} 

// Add this after setupEventListeners function
function setupRecurringTaskFields() {
    const recurringToggle = document.getElementById('recurring-toggle');
    const recurringFields = document.querySelectorAll('.recurring-fields');
    const dayCheckboxes = document.querySelectorAll('input[name="days"]');
    const untilDateInput = document.getElementById('until-date');

    if (recurringToggle) {
        recurringToggle.addEventListener('change', (e) => {
            const isRecurring = e.target.checked;
            
            // Show/hide recurring fields
            recurringFields.forEach(field => {
                field.style.display = isRecurring ? 'block' : 'none';
            });
            
            // Enable/disable day checkboxes and until date
            dayCheckboxes.forEach(checkbox => {
                checkbox.disabled = !isRecurring;
                if (!isRecurring) {
                    checkbox.checked = false;
                }
            });
            
            untilDateInput.disabled = !isRecurring;
            if (!isRecurring) {
                untilDateInput.value = '';
            }
        });
    }
}

// Add helper functions to get task information
function getSelectedTask() {
    const taskRow = document.querySelector('.task-row.selected');
    if (!taskRow) return null;
    
    return {
        taskId: taskRow.dataset.taskId,
        title: taskRow.querySelector('.task-name').textContent,
        projectName: taskRow.querySelector('.project-name').textContent
    };
}

// Add mouse and keyboard activity handlers
function handleMouseActivity() {
    if (isTimerRunning) {
        window.electronAPI.trackMouseActivity();
    }
}

function handleKeyboardActivity() {
    if (isTimerRunning) {
        window.electronAPI.trackKeyboardActivity();
    }
}