// Function to get initial letter from name
function getInitial(name) {
    return name ? name.charAt(0).toUpperCase() : '?';
}

// Function to update profile information
function updateProfileInfo() {
    const userId = localStorage.getItem('userId');
    const fullName = localStorage.getItem('fullName');
    const token = localStorage.getItem('token');

    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    // Decode JWT token to get email
    const tokenPayload = JSON.parse(atob(token.split('.')[1]));
    const email = tokenPayload.email;

    // Get initial letter for avatar
    const initial = getInitial(fullName);

    // Update profile button initial
    document.getElementById('user-initial').textContent = initial;
    
    // Update profile menu initial
    document.getElementById('profile-initial').textContent = initial;

    // Update profile menu info
    document.getElementById('profile-full-name').textContent = fullName;
    document.getElementById('profile-email').textContent = email;
    document.getElementById('profile-user-id').textContent = `ID: ${userId}`;
}

// Toggle profile menu
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

// Initialize profile when page loads
document.addEventListener('DOMContentLoaded', () => {
    updateProfileInfo();
}); 