// API Configuration
const config = {
    API_BASE_URL: 'https://actracker.onrender.com',
    API_TIMEOUT: 30000, // 30 seconds
    DEFAULT_HOURLY_RATE: 20
};

// Export the config object
if (typeof module !== 'undefined' && module.exports) {
    module.exports = config;
} else {
    window.config = config;
} 