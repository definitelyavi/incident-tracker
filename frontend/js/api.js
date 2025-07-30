class ApiService {
    constructor() {
        this.baseURL = 'http://localhost:3001/api';
        this.token = localStorage.getItem('auth_token');
        this.refreshToken = localStorage.getItem('refresh_token');
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        };

        if (this.token) {
            config.headers.Authorization = `Bearer ${this.token}`;
        }

        if (config.body && typeof config.body === 'object') {
            config.body = JSON.stringify(config.body);
        }

        try {
            const response = await fetch(url, config);
            
            if (response.status === 401 && this.refreshToken) {
                const refreshed = await this.refreshAuthToken();
                if (refreshed) {
                    config.headers.Authorization = `Bearer ${this.token}`;
                    return fetch(url, config).then(this.handleResponse);
                }
                this.handleAuthError();
                return;
            }

            return this.handleResponse(response);
        } catch (error) {
            console.error('API request failed:', error);
            throw new Error('Network error occurred');
        }
    }

    async handleResponse(response) {
        const contentType = response.headers.get('content-type');
        
        if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.message || `HTTP ${response.status}`);
            }
            
            return data;
        }
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        return response;
    }

    async refreshAuthToken() {
        try {
            const response = await fetch(`${this.baseURL}/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: this.refreshToken })
            });

            if (response.ok) {
                const data = await response.json();
                this.setAuthTokens(data.token, data.refreshToken);
                return true;
            }
        } catch (error) {
            console.error('Token refresh failed:', error);
        }
        
        return false;
    }

    setAuthTokens(token, refreshToken = null) {
        this.token = token;
        localStorage.setItem('auth_token', token);
        
        if (refreshToken) {
            this.refreshToken = refreshToken;
            localStorage.setItem('refresh_token', refreshToken);
        }
    }

    clearAuthTokens() {
        this.token = null;
        this.refreshToken = null;
        localStorage.removeItem('auth_token');
        localStorage.removeItem('refresh_token');
    }

    handleAuthError() {
        this.clearAuthTokens();
        window.location.href = '/login.html';
    }

    async getCurrentUser() {
        return this.request('/auth/me');
    }

    async getTickets(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        return this.request(`/tickets${queryString ? `?${queryString}` : ''}`);
    }

    async createTicket(ticketData) {
        return this.request('/tickets', {
            method: 'POST',
            body: ticketData
        });
    }

    async updateTicket(id, ticketData) {
        return this.request(`/tickets/${id}`, {
            method: 'PUT',
            body: ticketData
        });
    }

    async deleteTicket(id) {
        return this.request(`/tickets/${id}`, {
            method: 'DELETE'
        });
    }

    async addTicketComment(id, comment) {
        return this.request(`/tickets/${id}/comments`, {
            method: 'POST',
            body: { comment }
        });
    }

    async getTicketComments(id) {
        return this.request(`/tickets/${id}/comments`);
    }

    async getUsers(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        return this.request(`/users${queryString ? `?${queryString}` : ''}`);
    }

    async createUser(userData) {
        return this.request('/users', {
            method: 'POST',
            body: userData
        });
    }

    async updateUser(id, userData) {
        return this.request(`/users/${id}`, {
            method: 'PUT',
            body: userData
        });
    }

    async deleteUser(id) {
        return this.request(`/users/${id}`, {
            method: 'DELETE'
        });
    }

    async getDashboardStats() {
        return this.request('/analytics/dashboard');
    }

    async getNotifications(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        return this.request(`/notifications${queryString ? `?${queryString}` : ''}`);
    }

    async markAllNotificationsRead() {
        return this.request('/notifications/read-all', {
            method: 'PATCH'
        });
    }

    async searchTickets(query, filters = {}) {
        return this.request('/search/tickets', {
            method: 'POST',
            body: { query, filters }
        });
    }

    formatErrorMessage(error) {
        if (error.message) {
            return error.message;
        }
        
        if (typeof error === 'string') {
            return error;
        }
        
        return 'An unexpected error occurred';
    }
}

window.apiService = new ApiService();