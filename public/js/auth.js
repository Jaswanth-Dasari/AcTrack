// Add this at the beginning of the file
function checkAuthAndRedirect() {
    const token = localStorage.getItem('token');
    const currentPage = window.location.pathname.split('/').pop();
    
    if (token) {
        // Check if token is expired
        try {
            const tokenPayload = JSON.parse(atob(token.split('.')[1]));
            const currentTime = Math.floor(Date.now() / 1000);
            
            if (tokenPayload.exp && tokenPayload.exp < currentTime) {
                // Token is expired
                localStorage.clear();
                window.location.href = 'login.html';
                return;
            }
        } catch (error) {
            console.error('Error checking token:', error);
            localStorage.clear();
            window.location.href = 'login.html';
            return;
        }
        
        // If user is authenticated and tries to access login/register pages
        if (currentPage === 'login.html' || currentPage === 'register.html') {
            window.location.href = 'index.html';
        }
    } else {
        // If user is not authenticated and tries to access index page
        if (currentPage === 'index.html') {
            window.location.href = 'login.html';
        }
    }
}

// Add this function to update profile information
function updateProfileInfo() {
    const fullName = localStorage.getItem('fullName');
    const token = localStorage.getItem('token');
    const userId = localStorage.getItem('userId');

    if (!token || !fullName || !userId) {
        return;
    }

    // Get initial letter for avatar
    const initial = fullName.charAt(0).toUpperCase();

    // Update profile button initial
    const userInitialEl = document.getElementById('user-initial');
    if (userInitialEl) {
        userInitialEl.textContent = initial;
    }

    // Update profile menu initial
    const profileInitialEl = document.getElementById('profile-initial');
    if (profileInitialEl) {
        profileInitialEl.textContent = initial;
    }

    // Update profile menu info
    const profileFullNameEl = document.getElementById('profile-full-name');
    if (profileFullNameEl) {
        profileFullNameEl.textContent = fullName;
    }

    // Get email from token
    try {
        const tokenPayload = JSON.parse(atob(token.split('.')[1]));
        const email = tokenPayload.email;
        const profileEmailEl = document.getElementById('profile-email');
        if (profileEmailEl) {
            profileEmailEl.textContent = email;
        }
    } catch (error) {
        console.error('Error decoding token:', error);
    }

    // Update user ID
    const profileUserIdEl = document.getElementById('profile-user-id');
    if (profileUserIdEl) {
        profileUserIdEl.textContent = `ID: ${userId}`;
    }
}

// Add this function to toggle profile menu
function toggleProfileMenu(event) {
    if (event) {
        event.stopPropagation();
    }
    const menu = document.getElementById('profileMenu');
    menu.classList.toggle('active');

    // Close menu when clicking outside
    function closeMenu(e) {
        if (!e.target.closest('.profile-controls')) {
            menu.classList.remove('active');
            document.removeEventListener('click', closeMenu);
        }
    }

    if (menu.classList.contains('active')) {
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 0);
    }
}

// Handle login form submission
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    try {
        clearMessages();

        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;

        // Check if fields are empty
        if (!email || !password) {
            showError('Email and password are required');
            return;
        }

        console.log('Attempting login for email:', email);

        const response = await fetch('https://actracker.onrender.com/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();
        console.log('Server response status:', response.status);
        console.log('Server response:', data);

        if (!response.ok) {
            const errorMessage = data.details || data.error || 'Login failed';
            throw new Error(errorMessage);
        }

        // Store user data in localStorage
        localStorage.setItem('token', data.token);
        localStorage.setItem('userId', data.userId);
        localStorage.setItem('fullName', data.fullName);
        
        console.log('User logged in successfully:', data.userId);

        showSuccess('Login successful! Redirecting to dashboard...');

        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1000);

    } catch (error) {
        console.error('Authentication error occurred:', error);
        showError(error.message || 'Login failed. Please try again.');
    }
});

// Handle registration form submission
document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    try {
        clearMessages();

        const fullName = document.getElementById('fullName').value.trim();
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        // Client-side validation
        if (!fullName || !email || !password) {
            showError('All fields are required');
            return;
        }

        console.log('Sending registration request...');

        const response = await fetch('https://actracker.onrender.com/api/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ 
                fullName,
                email,
                password 
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Registration failed');
        }

        showSuccess('Registration successful! Redirecting to login...');

        // Store only email for login page
        sessionStorage.setItem('registeredEmail', email);

        setTimeout(() => {
            window.location.href = 'login.html';
        }, 1500);

    } catch (error) {
        console.error('Registration error occurred');
        showError(error.message || 'Registration failed. Please try again.');
    }
});

// Helper function to show errors
function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    errorDiv.textContent = message;
    
    // Remove any existing error messages
    document.querySelectorAll('.error').forEach(el => el.remove());
    
    // Add new error message
    const form = document.querySelector('form');
    form.insertBefore(errorDiv, form.firstChild);
}

// Add success message function
function showSuccess(message) {
    const successDiv = document.createElement('div');
    successDiv.className = 'success';
    successDiv.textContent = message;
    
    // Remove any existing messages
    document.querySelectorAll('.success, .error').forEach(el => el.remove());
    
    // Add new success message
    const form = document.querySelector('form');
    form.insertBefore(successDiv, form.firstChild);
}

// Add this helper function
function clearMessages() {
    document.querySelectorAll('.error, .success').forEach(el => el.remove());
}

// Add this function to pre-fill email after registration
function checkForRegisteredEmail() {
    const registeredEmail = sessionStorage.getItem('registeredEmail');
    if (registeredEmail && document.getElementById('email')) {
        document.getElementById('email').value = registeredEmail;
        sessionStorage.removeItem('registeredEmail'); // Clear it after use
        showSuccess('Registration successful! Please login with your credentials.');
    }
}

// Update the DOMContentLoaded handler
document.addEventListener('DOMContentLoaded', () => {
    checkAuthAndRedirect();
    updateProfileInfo();
    checkForRegisteredEmail();
}); 