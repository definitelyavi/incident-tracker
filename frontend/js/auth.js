class AuthManager {
    constructor() {
        this.apiBase = '/api';
        this.currentUser = null;
        this.token = localStorage.getItem('auth_token');
        this.refreshToken = localStorage.getItem('refresh_token');
        
        this.setupTokenRefresh();
    }
    
    isAuthenticated() {
        return !!this.token && !!this.currentUser;
    }
    
    getCurrentUser() {
        if (!this.currentUser) {
            const userData = localStorage.getItem('user_data');
            if (userData) {
                try {
                    this.currentUser = JSON.parse(userData);
                } catch (error) {
                    console.error('Error parsing user data:', error);
                    this.clearAuthData();
                }
            }
        }
        return this.currentUser;
    }
    
    getToken() {
        return this.token;
    }
    
    async initialize() {
        try {
            if (!this.token) {
                this.redirectToLogin();
                return false;
            }
            
            const isValid = await this.verifyToken();
            if (!isValid) {
                this.redirectToLogin();
                return false;
            }
            
            return true;
        } catch (error) {
            console.error('Auth initialization failed:', error);
            this.redirectToLogin();
            return false;
        }
    }
    
    async verifyToken() {
        try {
            const response = await fetch(`${this.apiBase}/auth/me`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.currentUser = data.user;
                localStorage.setItem('user_data', JSON.stringify(data.user));
                return true;
            } else if (response.status === 401) {
                return await this.refreshAccessToken();
            } else {
                return false;
            }
        } catch (error) {
            console.error('Token verification failed:', error);
            return false;
        }
    }
    
    async refreshAccessToken() {
        try {
            if (!this.refreshToken) {
                return false;
            }
            
            const response = await fetch(`${this.apiBase}/auth/refresh`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    refreshToken: this.refreshToken
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                this.token = data.token;
                this.refreshToken = data.refreshToken;
                
                localStorage.setItem('auth_token', this.token);
                localStorage.setItem('refresh_token', this.refreshToken);
                
                return true;
            } else {
                this.clearAuthData();
                return false;
            }
        } catch (error) {
            console.error('Token refresh failed:', error);
            this.clearAuthData();
            return false;
        }
    }
    
    async makeAuthenticatedRequest(url, options = {}) {
        if (!this.token) {
            console.error('No token available for request');
            throw new Error('Not authenticated');
        }
        
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`,
            ...options.headers
        };
        
        let response = await fetch(url, {
            ...options,
            headers
        });
        
        if (response.status === 401) {
            const refreshed = await this.refreshAccessToken();
            if (refreshed) {
                headers['Authorization'] = `Bearer ${this.token}`;
                response = await fetch(url, {
                    ...options,
                    headers
                });
            } else {
                console.error('Could not refresh token');
                throw new Error('Not authenticated');
            }
        }
        
        return response;
    }
    
    async login(email, password) {
        try {
            const response = await fetch(`${this.apiBase}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.token = data.token;
                this.refreshToken = data.refreshToken;
                this.currentUser = data.user;
                
                localStorage.setItem('auth_token', this.token);
                localStorage.setItem('refresh_token', this.refreshToken);
                localStorage.setItem('user_data', JSON.stringify(this.currentUser));
                
                return { success: true, user: this.currentUser };
            } else {
                return { success: false, message: data.message || 'Login failed' };
            }
        } catch (error) {
            console.error('Login error:', error);
            return { success: false, message: 'Connection error. Please try again.' };
        }
    }
    
    async logout() {
        try {
            if (this.token && this.refreshToken) {
                await fetch(`${this.apiBase}/auth/logout`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        'Content-Type': 'application/json'
                    }
                });
            }
        } catch (error) {
            console.error('Logout API call failed:', error);
        } finally {
            this.clearAuthData();
            this.redirectToLogin();
        }
    }
    
    clearAuthData() {
        this.token = null;
        this.refreshToken = null;
        this.currentUser = null;
        
        localStorage.removeItem('auth_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user_data');
    }
    
    redirectToLogin() {
        if (window.location.pathname !== '/login.html') {
            window.location.href = '/login.html';
        }
    }
    
    setupTokenRefresh() {
        setInterval(async () => {
            if (this.token && this.refreshToken) {
                await this.refreshAccessToken();
            }
        }, 10 * 60 * 1000);
    }
    
    hasRole(role) {
        const user = this.getCurrentUser();
        if (!user) return false;
        
        const roles = ['viewer', 'agent', 'admin'];
        const userRoleIndex = roles.indexOf(user.role);
        const requiredRoleIndex = roles.indexOf(role);
        
        return userRoleIndex >= requiredRoleIndex;
    }
    
    isAdmin() {
        return this.hasRole('admin');
    }
    
    isAgent() {
        return this.hasRole('agent');
    }
}

window.authManager = new AuthManager();

document.addEventListener('DOMContentLoaded', () => {
    if (window.location.pathname.includes('login.html')) {
        return;
    }
    
    window.authManager.initialize();
});