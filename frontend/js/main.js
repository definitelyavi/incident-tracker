class IncidentTracker {
    constructor() {
        this.currentUser = null;
        this.tickets = [];
        this.users = [];
        this.authManager = null;
        this.editingTicket = null;
        this.editingUser = null; 
        this.dashboardManager = null;
        this.notificationManager = null;
        
        this.initializeApp();
    }

    async initializeApp() {
        try {
            this.authManager = window.authManager;
            
            if (!this.authManager) {
                console.error('Auth manager not available');
                return;
            }
            
            const isAuthenticated = await this.checkAuthentication();
            
            if (!isAuthenticated) {
                return;
            }
            
            this.currentUser = this.authManager.getCurrentUser();
            
            await this.init();
            await this.loadInitialData();
            this.updateDashboard();
            
        } catch (error) {
            console.error('App initialization failed:', error);
            this.showNotification('Failed to initialize application. Please refresh the page.', 'error');
        }
    }

    async checkAuthentication() {
        try {
            return await this.authManager.initialize();
        } catch (error) {
            console.error('Authentication check failed:', error);
            return false;
        }
    }

    async init() {
        this.initTabNavigation();
        this.initModals();
        this.initEventListeners();
        this.initFilters();
        
        this.dashboardManager = new DashboardManager(this);
        window.dashboardManager = this.dashboardManager;
        
        this.notificationManager = new NotificationManager(this);
        window.notificationManager = this.notificationManager;
        
        this.updateUserInterface();
    }

    updateUserInterface() {
        if (!this.currentUser) return;
        
        const userNameEl = document.querySelector('.user-name');
        const userRoleEl = document.querySelector('.user-role');
        
        if (userNameEl) userNameEl.textContent = this.currentUser.name;
        if (userRoleEl) userRoleEl.textContent = this.formatRole(this.currentUser.role);
        
        this.updateRoleBasedVisibility();
        this.setupUserProfileMenu();
    }

    formatRole(role) {
        const roleMap = {
            'admin': 'Admin',
            'agent': 'Agent', 
            'viewer': 'Viewer'
        };
        return roleMap[role] || role;
    }

    updateRoleBasedVisibility() {
        if (!this.currentUser) return;
        
        const role = this.currentUser.role;
        
        const usersTab = document.querySelector('[data-tab="users"]');
        if (usersTab && role === 'viewer') {
            usersTab.style.display = 'none';
        }
        
        const analyticsTab = document.querySelector('[data-tab="analytics"]');
        if (analyticsTab && role === 'viewer') {
            analyticsTab.style.display = 'none';
        }
        
        const createUserBtn = document.getElementById('create-user-btn');
        if (createUserBtn && role !== 'admin') {
            createUserBtn.style.display = 'none';
        }
    }

    setupUserProfileMenu() {
        const userProfile = document.querySelector('.user-profile');
        if (!userProfile) return;
        
        userProfile.addEventListener('click', (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (confirm('Are you sure you want to logout?')) {
                    this.authManager.logout();
                }
            }
        });
        
        userProfile.title = 'Ctrl+Click to logout';
        userProfile.style.cursor = 'pointer';
    }

    async loadInitialData() {
        this.showLoading();
        
        try {
            await Promise.all([
                this.loadTicketsFromAPI(),
                this.loadUsersFromAPI(),
                this.loadDashboardData()
            ]);
        } catch (error) {
            console.error('Failed to load initial data:', error);
            this.showNotification('Failed to load data from server', 'warning');
        } finally {
            this.hideLoading();
        }
    }

    async loadTicketsFromAPI() {
        try {
            const response = await this.authManager.makeAuthenticatedRequest('/api/tickets');
            
            if (response.ok) {
                const data = await response.json();
                this.tickets = data.tickets || [];
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('Failed to load tickets:', error);
            this.tickets = [];
            throw error;
        }
    }

    async loadUsersFromAPI() {
        try {
            const response = await this.authManager.makeAuthenticatedRequest('/api/users');
            
            if (response.ok) {
                const data = await response.json();
                this.users = data.users || [];
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('Failed to load users:', error);
            this.users = [];
            
            if (this.currentUser && ['admin', 'agent'].includes(this.currentUser.role)) {
                throw error;
            }
        }
    }

    async loadDashboardData() {
        try {
            const [dashboardResponse, slaResponse] = await Promise.all([
                this.authManager.makeAuthenticatedRequest('/api/analytics/dashboard'),
                this.authManager.makeAuthenticatedRequest('/api/sla/compliance')
            ]);
            
            if (dashboardResponse.ok) {
                const data = await dashboardResponse.json();
                this.dashboardData = data;
            }
            
            if (slaResponse.ok) {
                const slaData = await slaResponse.json();
                this.slaData = slaData;
            }
        } catch (error) {
            console.error('Failed to load dashboard data:', error);
            this.dashboardData = null;
            this.slaData = null;
        }
    }

    async loadTicketComments(ticketId) {
        try {
            const response = await this.authManager.makeAuthenticatedRequest(`/api/tickets/${ticketId}/comments`);
            if (response.ok) {
                const data = await response.json();
                return data.comments || [];
            } else {
                return [];
            }
        } catch (error) {
            console.error('Failed to load comments:', error);
            return [];
        }
    }

    async addComment(ticketId, comment, isInternal = false) {
        try {
            const response = await this.authManager.makeAuthenticatedRequest(`/api/tickets/${ticketId}/comments`, {
                method: 'POST',
                body: JSON.stringify({ comment, is_internal: isInternal })
            });
            
            if (response.ok) {
                this.showNotification('Comment added successfully', 'success');
                await this.loadAndDisplayComments(ticketId);
                
                const commentInput = document.getElementById('new-comment');
                if (commentInput) commentInput.value = '';
            }
        } catch (error) {
            this.showNotification('Failed to add comment', 'error');
        }
    }

    async loadAndDisplayComments(ticketId) {
        const comments = await this.loadTicketComments(ticketId);
        this.renderComments(comments);
    }

    renderComments(comments) {
        const commentsList = document.getElementById('comments-list');
        if (!commentsList) return;
        
        if (!comments || !Array.isArray(comments) || comments.length === 0) {
            commentsList.innerHTML = '<p>No comments yet.</p>';
            return;
        }
        
        commentsList.innerHTML = comments.map(comment => `
            <div class="comment-item ${comment.is_internal ? 'internal' : ''}">
                <div class="comment-header">
                    <strong>${this.escapeHtml(comment.user_name || 'Unknown User')}</strong>
                    <span class="comment-time">${this.getTimeAgo(comment.created_at)}</span>
                    ${comment.is_internal ? '<span class="internal-badge">Internal</span>' : ''}
                </div>
                <div class="comment-text">${this.escapeHtml(comment.comment)}</div>
            </div>
        `).join('');
    }

    initTabNavigation() {
        const tabs = document.querySelectorAll('.nav-tab');
        const tabContents = document.querySelectorAll('.tab-content');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.getAttribute('data-tab');
                
                if (!this.canAccessTab(tabName)) {
                    this.showNotification('You do not have permission to access this section', 'error');
                    return;
                }
                
                tabs.forEach(t => t.classList.remove('active'));
                tabContents.forEach(content => content.classList.remove('active'));
                
                tab.classList.add('active');
                document.getElementById(tabName).classList.add('active');
                
                this.loadTabData(tabName);
            });
        });
    }

    canAccessTab(tabName) {
        if (!this.currentUser) return false;
        
        const role = this.currentUser.role;
        
        switch (tabName) {
            case 'dashboard':
            case 'tickets':
                return true;
            case 'users':
            case 'analytics':
                return ['admin', 'agent'].includes(role);
            default:
                return true;
        }
    }

    initModals() {
        const createTicketBtn = document.getElementById('create-ticket-btn');
        const closeModalBtn = document.getElementById('close-modal');
        const cancelTicketBtn = document.getElementById('cancel-ticket');

        createTicketBtn?.addEventListener('click', () => {
            if (this.canCreateTickets()) {
                this.openTicketModal();
            } else {
                this.showNotification('You do not have permission to create tickets', 'error');
            }
        });

        closeModalBtn?.addEventListener('click', () => {
            this.closeModal('ticket-modal');
        });

        cancelTicketBtn?.addEventListener('click', () => {
            this.closeModal('ticket-modal');
        });

        const createUserBtn = document.getElementById('create-user-btn');
        const closeUserModalBtn = document.getElementById('close-user-modal');
        const cancelUserBtn = document.getElementById('cancel-user');

        createUserBtn?.addEventListener('click', () => {
            if (this.canCreateUsers()) {
                this.openUserModal();
            } else {
                this.showNotification('You do not have permission to create users', 'error');
            }
        });

        closeUserModalBtn?.addEventListener('click', () => {
            this.closeModal('user-modal');
        });

        cancelUserBtn?.addEventListener('click', () => {
            this.closeModal('user-modal');
        });

        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.closeModal(e.target.id);
            }
        });
    }

    canCreateTickets() {
        return this.currentUser && ['admin', 'agent'].includes(this.currentUser.role);
    }

    canCreateUsers() {
        return this.currentUser && this.currentUser.role === 'admin';
    }

    initEventListeners() {
        const ticketForm = document.getElementById('ticket-form');
        ticketForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveTicket();
        });

        const userForm = document.getElementById('user-form');
        userForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveUser();
        });

        const ticketSearch = document.getElementById('ticket-search');
        ticketSearch?.addEventListener('input', (e) => {
            this.searchTickets(e.target.value);
        });

        const createTicketBtnDashboard = document.getElementById('create-ticket-btn');
        const createTicketBtnTickets = document.getElementById('create-ticket-btn-tickets');

        createTicketBtnDashboard?.addEventListener('click', () => {
            if (this.canCreateTickets()) {
                this.openTicketModal();
            } else {
                this.showNotification('You do not have permission to create tickets', 'error');
            }
        });

        createTicketBtnTickets?.addEventListener('click', () => {
            if (this.canCreateTickets()) {
                this.openTicketModal();
            } else {
                this.showNotification('You do not have permission to create tickets', 'error');
            }
        });

        const addCommentBtn = document.getElementById('add-comment-btn');
        addCommentBtn?.addEventListener('click', () => {
            const commentText = document.getElementById('new-comment')?.value?.trim();
            if (commentText && this.editingTicket) {
                this.addComment(this.editingTicket.id, commentText, false);
            } else if (!commentText) {
                this.showNotification('Please enter a comment', 'error');
            } else {
                this.showNotification('No ticket selected', 'error');
            }
        });

        const newCommentInput = document.getElementById('new-comment');
        newCommentInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const commentText = e.target.value.trim();
                if (commentText && this.editingTicket) {
                    this.addComment(this.editingTicket.id, commentText, false);
                }
            }
        });

        const resetDemoBtn = document.getElementById('reset-demo-btn');
        resetDemoBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this.resetDemoData();
        });
    }

    initFilters() {
        const statusFilter = document.getElementById('status-filter');
        const priorityFilter = document.getElementById('priority-filter');

        statusFilter?.addEventListener('change', () => {
            this.filterTickets();
        });

        priorityFilter?.addEventListener('change', () => {
            this.filterTickets();
        });
    }

    async loadTabData(tabName) {
        this.showLoading();
        
        try {
            switch(tabName) {
                case 'dashboard':
                    await this.loadDashboardData();
                    this.updateDashboard();
                    break;
                case 'tickets':
                    await this.loadTicketsFromAPI();
                    this.loadTickets();
                    break;
                case 'users':
                    await this.loadUsersFromAPI();
                    this.loadUsers();
                    break;
                case 'analytics':
                    this.loadAnalytics();
                    break;
            }
        } catch (error) {
            console.error(`Failed to load ${tabName} data:`, error);
            this.showNotification(`Failed to load ${tabName} data`, 'error');
        } finally {
            this.hideLoading();
        }
    }

async saveTicket() {
        const ticketData = {
            title: document.getElementById('ticket-title').value.trim(),
            description: document.getElementById('ticket-description').value.trim(),
            priority: document.getElementById('ticket-priority').value,
            status: document.getElementById('ticket-status').value,
            category: document.getElementById('ticket-category').value,
            assignee_id: document.getElementById('ticket-assignee').value || null
        };

        if (!ticketData.title || !ticketData.description) {
            this.showNotification('Please fill in all required fields', 'error');
            return;
        }

        this.showLoading();

        try {
            let response;
            let successMessage;
            
            if (this.editingTicket) {
                response = await this.authManager.makeAuthenticatedRequest(`/api/tickets/${this.editingTicket.id}`, {
                    method: 'PUT',
                    body: JSON.stringify(ticketData)
                });
                successMessage = 'Ticket updated successfully';
            } else {
                response = await this.authManager.makeAuthenticatedRequest('/api/tickets', {
                    method: 'POST',
                    body: JSON.stringify(ticketData)
                });
                successMessage = 'Ticket created successfully';
            }

            if (response.ok) {
                const data = await response.json();
                this.showNotification(successMessage, 'success');
                
                this.addRecentActivity(ticketData, data);
                
                if (this.notificationManager) {
                    if (this.editingTicket) {
                        const oldStatus = this.editingTicket.status;
                        const newStatus = ticketData.status;
                        const oldAssigneeId = this.editingTicket.assignee_id;
                        const newAssigneeId = ticketData.assignee_id;
                        
                        if (oldStatus !== 'resolved' && newStatus === 'resolved') {
                            this.notificationManager.addNotification(
                                'ticket-resolved',
                                'Ticket Resolved',
                                `Ticket "${ticketData.title}" has been marked as resolved`,
                                { ticketId: this.editingTicket.id }
                            );
                        } else if (oldAssigneeId !== newAssigneeId && newAssigneeId) {
                            const assignee = this.users.find(u => u.id == newAssigneeId);
                            this.notificationManager.addNotification(
                                'ticket-assigned',
                                'Ticket Assigned',
                                `Ticket "${ticketData.title}" has been assigned to ${assignee?.name || 'someone'}`,
                                { ticketId: this.editingTicket.id, assigneeId: newAssigneeId }
                            );
                        } else {
                            this.notificationManager.addNotification(
                                'ticket-updated',
                                'Ticket Updated',
                                `Ticket "${ticketData.title}" has been updated`,
                                { ticketId: this.editingTicket.id }
                            );
                        }
                    } else {
                        this.notificationManager.addNotification(
                            'ticket-created',
                            'Ticket Created',
                            `New ticket "${ticketData.title}" has been created`,
                            { ticketId: data.ticket?.id }
                        );
                    }
                }

                this.closeModal('ticket-modal');
                this.editingTicket = null;

                await this.loadTicketsFromAPI();
                await this.loadDashboardData();

                const activeTab = document.querySelector('.nav-tab.active')?.getAttribute('data-tab');
                if (activeTab === 'tickets') {
                    this.loadTickets();
                } else if (activeTab === 'dashboard') {
                    this.updateDashboard();
                } else if (activeTab === 'analytics') {
                    this.loadAnalytics();
                }
            
                this.updateDashboard();
                this.refreshAnalytics();
            
            } else {
                const error = await response.json();
                this.showNotification(error.message || 'Failed to save ticket', 'error');
            }
        } catch (error) {
            console.error('Failed to save ticket:', error);
            this.showNotification('Failed to save ticket. Please try again.', 'error');
        } finally {
            this.hideLoading();
        }
    }

    addRecentActivity(ticketData, responseData) {
        if (!this.dashboardData) {
            this.dashboardData = {};
        }
        if (!this.dashboardData.recent_activity) {
            this.dashboardData.recent_activity = [];
        }

        const activity = {
            action: this.editingTicket ? 'update' : 'create',
            resource_type: 'ticket',
            resource_id: responseData.ticket?.id || this.editingTicket?.id,
            user_name: this.currentUser.name,
            timestamp: new Date().toISOString(),
            details: {
                title: ticketData.title,
                priority: ticketData.priority,
                status: ticketData.status
            }
        };

        this.dashboardData.recent_activity.unshift(activity);
        this.dashboardData.recent_activity = this.dashboardData.recent_activity.slice(0, 10);
    }

    async saveUser() {
        const userData = {
            name: document.getElementById('user-name').value.trim(),
            email: document.getElementById('user-email').value.trim(),
            role: document.getElementById('user-role').value
        };

        if (!this.editingUser) {
            userData.password = 'defaultPassword123!';
        }

        if (!userData.name || !userData.email || !userData.role) {
            this.showNotification('Please fill in all required fields', 'error');
            return;
        }

        this.showLoading();

        try {
            let response;
            let successMessage;
            let url;
            let method;

            if (this.editingUser) {
                url = `/api/users/${this.editingUser.id}`;
                method = 'PUT';
                successMessage = 'User updated successfully';
            } else {
                url = '/api/users';
                method = 'POST';
                successMessage = 'User created successfully';
            }

            response = await this.authManager.makeAuthenticatedRequest(url, {
                method: method,
                body: JSON.stringify(userData)
            });

            if (response.ok) {
                const data = await response.json();
                this.showNotification(successMessage, 'success');
                
                if (this.notificationManager) {
                    if (this.editingUser) {
                        this.notificationManager.addNotification(
                            'user-updated',
                            'User Updated',
                            `User "${userData.name}" has been updated`,
                            { userId: this.editingUser.id }
                        );
                    } else {
                        this.notificationManager.addNotification(
                            'user-created',
                            'New User Added',
                            `User "${userData.name}" has been created`,
                            { userId: data.user?.id }
                        );
                    }
                }
                
                this.closeModal('user-modal');
                this.editingUser = null;
                
                await this.loadUsersFromAPI();
                if (document.querySelector('[data-tab="users"].active')) {
                    this.loadUsers();
                }
            } else {
                const error = await response.json();
                this.showNotification(error.message || 'Failed to save user', 'error');
            }
        } catch (error) {
            console.error('Failed to save user:', error);
            this.showNotification('Failed to save user. Please try again.', 'error');
        } finally {
            this.hideLoading();
        }
    }

    loadTickets() {
        const tbody = document.getElementById('tickets-tbody');
        if (!tbody) return;

        tbody.innerHTML = '';

        if (this.tickets.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center" style="padding: 2rem;">
                        <div class="tickets-empty">
                            <i class="fas fa-ticket-alt"></i>
                            <h3>No tickets found</h3>
                            <p>There are no tickets to display.</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        this.tickets.forEach(ticket => {
            const row = this.createTicketRow(ticket);
            tbody.appendChild(row);
        });
    }

    createTicketRow(ticket) {
        const row = document.createElement('tr');
        const assignee = this.users.find(u => u.id === ticket.assignee_id);
        const createdDate = new Date(ticket.created_at).toLocaleDateString();

        row.innerHTML = `
            <td class="ticket-id">#${ticket.id}</td>
            <td class="ticket-title">${this.escapeHtml(ticket.title)}</td>
            <td><span class="priority-badge priority-${ticket.priority}">${ticket.priority}</span></td>
            <td><span class="status-badge status-${ticket.status}">${ticket.status.replace('-', ' ')}</span></td>
            <td class="assignee-info">
                ${assignee ? `
                    <div class="assignee-avatar">${this.getInitials(assignee.name)}</div>
                    <span class="assignee-name">${assignee.name}</span>
                ` : '<span class="unassigned">Unassigned</span>'}
            </td>
            <td class="ticket-date">${createdDate}</td>
            <td class="ticket-actions">
                <button class="action-btn edit" data-ticket-id="${ticket.id}" title="Edit">
                    <i class="fas fa-edit"></i>
                </button>
                ${this.currentUser.role === 'admin' ? `
                    <button class="action-btn delete" data-ticket-id="${ticket.id}" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                ` : ''}
            </td>
        `;

        const editBtn = row.querySelector('.action-btn.edit');
        const deleteBtn = row.querySelector('.action-btn.delete');

        if (editBtn) {
            editBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.editTicket(ticket.id);
            });
        }

        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.deleteTicket(ticket.id);
            });
        }

        return row;
    }

    editTicket(ticketId) {
        const ticket = this.tickets.find(t => t.id === ticketId);
        if (ticket) {
            this.editingTicket = ticket;
            this.populateTicketForm(ticket);
            this.openTicketModal(ticket);
        } else {
            this.showNotification('Ticket not found', 'error');
        }
    }

    async deleteTicket(ticketId) {
        const ticket = this.tickets.find(t => t.id === ticketId);
        const ticketTitle = ticket ? ticket.title : 'this ticket';
        
        const confirmed = await this.showConfirmation(
            'Delete Ticket',
            `Are you sure you want to delete "${ticketTitle}"? This action cannot be undone.`,
            'Delete',
            'Cancel'
        );
        
        if (!confirmed) return;
        
        try {
            this.showLoading();
            
            const response = await this.authManager.makeAuthenticatedRequest(`/api/tickets/${ticketId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                this.showNotification('Ticket deleted successfully', 'success');
                
                await this.loadTicketsFromAPI();
                this.loadTickets();
                this.updateDashboard();
            } else {
                const error = await response.json();
                this.showNotification(error.message || 'Failed to delete ticket', 'error');
            }
        } catch (error) {
            console.error('Delete ticket error:', error);
            this.showNotification('Failed to delete ticket. Please try again.', 'error');
        } finally {
            this.hideLoading();
        }
    }

loadUsers() {
        const usersGrid = document.getElementById('users-grid');
        if (!usersGrid) return;

        usersGrid.innerHTML = '';

        if (this.users.length === 0) {
            usersGrid.innerHTML = `
                <div class="users-empty">
                    <i class="fas fa-users"></i>
                    <h3>No users found</h3>
                    <p>There are no users to display.</p>
                </div>
            `;
            return;
        }

        this.users.forEach(user => {
            const userCard = this.createUserCard(user);
            usersGrid.appendChild(userCard);
        });
    }

    createUserCard(user) {
        const userDiv = document.createElement('div');
        userDiv.className = 'user-card';
        
        const userTickets = this.tickets.filter(t => t.assignee_id === user.id);
        const openTickets = userTickets.filter(t => ['open', 'in-progress'].includes(t.status)).length;
        const resolvedTickets = userTickets.filter(t => t.status === 'resolved').length;

        userDiv.innerHTML = `
            <div class="user-avatar">${this.getInitials(user.name)}</div>
            <div class="user-info">
                <h3 class="user-name">${this.escapeHtml(user.name)}</h3>
                <p class="user-email">${this.escapeHtml(user.email)}</p>
                <span class="user-role-badge role-${user.role}">${user.role}</span>
            </div>
            <div class="user-stats">
                <div class="stat">
                    <span class="stat-value">${openTickets}</span>
                    <span class="stat-label">Open</span>
                </div>
                <div class="stat">
                    <span class="stat-value">${resolvedTickets}</span>
                    <span class="stat-label">Resolved</span>
                </div>
            </div>
            <div class="user-actions">
                ${this.currentUser.role === 'admin' ? `
                    <button class="btn btn-secondary" data-user-id="${user.id}" data-action="edit" title="Edit User">
                        <i class="fas fa-edit"></i>
                    </button>
                    ${user.is_active ? `
                        <button class="btn btn-warning" data-user-id="${user.id}" data-action="deactivate" title="Deactivate User">
                            <i class="fas fa-user-slash"></i>
                        </button>
                    ` : `
                        <button class="btn btn-success" data-user-id="${user.id}" data-action="activate" title="Activate User">
                            <i class="fas fa-user-check"></i>
                        </button>
                    `}
                    ${user.role !== 'admin' ? `
                        <button class="btn btn-danger" data-user-id="${user.id}" data-action="delete" title="Delete User">
                            <i class="fas fa-trash"></i>
                        </button>
                    ` : ''}
                ` : ''}
            </div>
        `;

        const editBtn = userDiv.querySelector('[data-action="edit"]');
        const deleteBtn = userDiv.querySelector('[data-action="delete"]');
        const deactivateBtn = userDiv.querySelector('[data-action="deactivate"]');
        const activateBtn = userDiv.querySelector('[data-action="activate"]');

        if (editBtn) {
            editBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.editUser(user.id);
            });
        }

        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.deleteUser(user.id);
            });
        }

        if (deactivateBtn) {
            deactivateBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.deactivateUser(user.id);
            });
        }

        if (activateBtn) {
            activateBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.activateUser(user.id);
            });
        }

        return userDiv;
    }

    editUser(userId) {
        const user = this.users.find(u => u.id === userId);
        if (user) {
            this.editingUser = user;
            this.openUserModal(user);
        }
    }

    async deleteUser(userId) {
        const user = this.users.find(u => u.id === userId);
        if (!user) {
            this.showNotification('User not found', 'error');
            return;
        }

        const confirmed = await this.showConfirmation(
            'Delete User',
            `Are you sure you want to delete "${user.name}"? This action cannot be undone.`,
            'Delete',
            'Cancel'
        );
        
        if (!confirmed) return;
        
        try {
            this.showLoading();
            
            const response = await this.authManager.makeAuthenticatedRequest(`/api/users/${userId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                this.showNotification('User deleted successfully', 'success');
                await this.loadUsersFromAPI();
                this.loadUsers();
            } else {
                const error = await response.json();
                this.showNotification(error.message || 'Failed to delete user', 'error');
            }
        } catch (error) {
            console.error('Delete user error:', error);
            this.showNotification('Failed to delete user', 'error');
        } finally {
            this.hideLoading();
        }
    }

    async deactivateUser(userId) {
        const user = this.users.find(u => u.id === userId);
        if (!user) return;

        const confirmed = await this.showConfirmation(
            'Deactivate User',
            `Are you sure you want to deactivate "${user.name}"? They will not be able to log in but their data will be preserved.`,
            'Deactivate',
            'Cancel'
        );
        
        if (!confirmed) return;
        
        try {
            this.showLoading();
            
            const response = await this.authManager.makeAuthenticatedRequest(`/api/users/${userId}/status`, {
                method: 'PATCH',
                body: JSON.stringify({ is_active: false })
            });
            
            if (response.ok) {
                this.showNotification('User deactivated successfully', 'success');
                await this.loadUsersFromAPI();
                this.loadUsers();
            } else {
                const error = await response.json();
                this.showNotification(error.message || 'Failed to deactivate user', 'error');
            }
        } catch (error) {
            console.error('Deactivate user error:', error);
            this.showNotification('Failed to deactivate user', 'error');
        } finally {
            this.hideLoading();
        }
    }

    async activateUser(userId) {
        const user = this.users.find(u => u.id === userId);
        if (!user) return;

        try {
            this.showLoading();
            
            const response = await this.authManager.makeAuthenticatedRequest(`/api/users/${userId}/status`, {
                method: 'PATCH',
                body: JSON.stringify({ is_active: true })
            });
            
            if (response.ok) {
                this.showNotification('User activated successfully', 'success');
                await this.loadUsersFromAPI();
                this.loadUsers();
            } else {
                const error = await response.json();
                this.showNotification(error.message || 'Failed to activate user', 'error');
            }
        } catch (error) {
            console.error('Activate user error:', error);
            this.showNotification('Failed to activate user', 'error');
        } finally {
            this.hideLoading();
        }
    }

updateDashboard() {
        this.updateMetricsFromTickets();
        this.updateSLAProgress();
        
        const activityList = document.getElementById('activity-list');
        if (activityList) {
            if (this.dashboardData && this.dashboardData.recent_activity && this.dashboardData.recent_activity.length > 0) {
                this.updateRecentActivity();
            } else {
                activityList.innerHTML = '<p class="text-center" style="color: #888; padding: 2rem;">No recent activity</p>';
            }
        }
    }

    updateMetricsFromTickets() {
        const criticalCount = this.tickets.filter(t => 
            t.priority === 'critical' && 
            !['resolved', 'closed'].includes(t.status)
        ).length;
        
        const highCount = this.tickets.filter(t => 
            t.priority === 'high' && 
            !['resolved', 'closed'].includes(t.status)
        ).length;
        
        const openCount = this.tickets.filter(t => 
            ['open', 'in-progress'].includes(t.status)
        ).length;
        
        const resolvedToday = this.tickets.filter(t => {
            if (!t.resolved_at) return false;
            const today = new Date();
            const resolved = new Date(t.resolved_at);
            return resolved.toDateString() === today.toDateString();
        }).length;

        const criticalEl = document.getElementById('critical-count');
        const highEl = document.getElementById('high-count');
        const openEl = document.getElementById('open-count');
        const resolvedEl = document.getElementById('resolved-count');

        if (criticalEl) criticalEl.textContent = criticalCount;
        if (highEl) highEl.textContent = highCount;
        if (openEl) openEl.textContent = openCount;
        if (resolvedEl) resolvedEl.textContent = resolvedToday;
    }

    updateSLAProgress() {
        if (this.slaData && this.slaData.length > 0) {
            this.updateSLAProgressFromBackend();
        } else {
            this.updateSLAProgressFromTickets();
        }
    }

    updateSLAProgressFromBackend() {
        let totalTickets = 0;
        let totalWithinSLA = 0;
        
        this.slaData.forEach(priority => {
            totalTickets += priority.total_tickets;
            totalWithinSLA += priority.within_sla;
        });
        
        const overallCompliance = totalTickets > 0 ? Math.round((totalWithinSLA / totalTickets) * 100) : 100;
        const responsePercentage = overallCompliance;
        const resolutionPercentage = overallCompliance;

        this.updateSLADisplay(responsePercentage, resolutionPercentage);
    }

    updateSLAProgressFromTickets() {
        const now = new Date();
        const activeTickets = this.tickets.filter(t => !['resolved', 'closed'].includes(t.status));
        
        let responseWithinSLA = 0;
        let resolutionWithinSLA = 0;
        let totalActive = activeTickets.length;
        let totalResolved = this.tickets.filter(t => t.resolved_at).length;

        activeTickets.forEach(ticket => {
            const responseTime = (now - new Date(ticket.created_at)) / (1000 * 60 * 60);
            if (responseTime <= 4) responseWithinSLA++;
        });

        this.tickets.filter(t => t.resolved_at).forEach(ticket => {
            const resolutionTime = (new Date(ticket.resolved_at) - new Date(ticket.created_at)) / (1000 * 60 * 60 * 24);
            if (resolutionTime <= 2) resolutionWithinSLA++;
        });

        const responsePercentage = totalActive > 0 ? Math.round((responseWithinSLA / totalActive) * 100) : 100;
        const resolutionPercentage = totalResolved > 0 ? Math.round((resolutionWithinSLA / totalResolved) * 100) : 100;

        this.updateSLADisplay(responsePercentage, resolutionPercentage);
    }

    updateSLADisplay(responsePercentage, resolutionPercentage) {
        const responseBar = document.querySelector('.sla-card:first-child .progress-fill');
        const resolutionBar = document.querySelector('.sla-card:last-child .progress-fill');
        const responseText = document.querySelector('.sla-card:first-child .sla-progress span');
        const resolutionText = document.querySelector('.sla-card:last-child .sla-progress span');

        if (responseBar) responseBar.style.width = `${responsePercentage}%`;
        if (resolutionBar) resolutionBar.style.width = `${resolutionPercentage}%`;
        if (responseText) responseText.textContent = `${responsePercentage}% within SLA`;
        if (resolutionText) resolutionText.textContent = `${resolutionPercentage}% within SLA`;
    }

    updateRecentActivity() {
        const activityList = document.getElementById('activity-list');
        if (!activityList) return;

        activityList.innerHTML = '';

        let activities = [];
        
        if (this.dashboardData && this.dashboardData.recent_activity) {
            activities = this.dashboardData.recent_activity;
        }

        if (activities.length === 0) {
            activityList.innerHTML = '<p class="text-center" style="color: #888; padding: 2rem;">No recent activity</p>';
            return;
        }

        activities.slice(0, 5).forEach(activity => {
            const activityItem = document.createElement('div');
            activityItem.className = 'activity-item';
            
            const timeAgo = activity.time_ago || this.getTimeAgo(activity.timestamp);
            
            activityItem.innerHTML = `
                <div class="activity-icon ${activity.action}">
                    <i class="fas fa-${this.getActivityIcon(activity.action)}"></i>
                </div>
                <div class="activity-details">
                    <div class="activity-title">${this.formatActivityDescription(activity)}</div>
                    <div class="activity-meta">
                        <span>by ${activity.user_name || 'Unknown User'}</span>
                        <span class="activity-time">${timeAgo}</span>
                    </div>
                </div>
            `;
            
            activityList.appendChild(activityItem);
        });
    }

    formatActivityDescription(activity) {
        const action = activity.action;
        
        switch (action) {
            case 'ticket_created':
                return `Created ticket "${activity.title}" #${activity.ticket_id}`;
            case 'ticket_updated':
                return `Updated ticket "${activity.title}" #${activity.ticket_id}`;
            case 'ticket_resolved':
                return `Resolved ticket "${activity.title}" #${activity.ticket_id}`;
            case 'ticket_assigned':
                return `Assigned ticket "${activity.title}" #${activity.ticket_id}`;
            case 'ticket_escalated':
                return `Created ${activity.priority} priority ticket "${activity.title}" #${activity.ticket_id}`;
            case 'ticket_closed':
                return `Closed ticket "${activity.title}" #${activity.ticket_id}`;
            case 'user_created':
                return activity.description;
            default:
                const resourceType = activity.resource_type || 'ticket';
                const details = activity.details || {};
                
                switch (action) {
                    case 'create':
                        return `Created ${resourceType} "${details.title || ''}" #${activity.resource_id || activity.ticket_id}`;
                    case 'update':
                        return `Updated ${resourceType} "${details.title || ''}" #${activity.resource_id || activity.ticket_id}`;
                    case 'delete':
                        return `Deleted ${resourceType} "${details.title || ''}" #${activity.resource_id || activity.ticket_id}`;
                    case 'assign':
                        return `Assigned ${resourceType} #${activity.resource_id || activity.ticket_id} to ${details.assignee_name}`;
                    case 'status_change':
                        return `Changed status from ${details.from} to ${details.to}`;
                    default:
                        return `${action} ${resourceType} #${activity.resource_id || activity.ticket_id}`;
                }
        }
    }

async searchTickets(searchTerm) {
        if (!searchTerm.trim()) {
            await this.loadTicketsFromAPI();
            this.loadTickets();
            this.clearSearchHighlights();
            return;
        }

        try {
            const response = await this.authManager.makeAuthenticatedRequest(
                `/api/search/tickets?q=${encodeURIComponent(searchTerm)}`
            );
            
            if (response.ok) {
                const data = await response.json();
                this.tickets = data.tickets;
                this.loadTickets();
                
                setTimeout(() => {
                    this.highlightSearchTerms(searchTerm);
                }, 100);
                
                if (data.tickets.length === 0) {
                    this.showSearchNoResults(searchTerm);
                }
            } else {
                this.searchTicketsLocally(searchTerm);
            }
        } catch (error) {
            console.error('Search failed:', error);
            this.searchTicketsLocally(searchTerm);
        }
    }

    searchTicketsLocally(searchTerm) {
        const tbody = document.getElementById('tickets-tbody');
        if (!tbody) return;

        const rows = tbody.querySelectorAll('tr');
        let visibleCount = 0;
        
        rows.forEach(row => {
            const text = row.textContent.toLowerCase();
            const matches = text.includes(searchTerm.toLowerCase());
            row.style.display = matches ? '' : 'none';
            if (matches) visibleCount++;
        });
        
        setTimeout(() => {
            this.highlightSearchTerms(searchTerm);
        }, 100);
        
        if (visibleCount === 0) {
            this.showSearchNoResults(searchTerm);
        }
    }

    filterTickets() {
        const statusFilter = document.getElementById('status-filter');
        const priorityFilter = document.getElementById('priority-filter');
        const searchInput = document.getElementById('ticket-search');
        
        if (!statusFilter || !priorityFilter) return;
        
        const statusValue = statusFilter.value;
        const priorityValue = priorityFilter.value;
        const searchTerm = searchInput ? searchInput.value.trim() : '';
        
        this.clearSearchHighlights();
        
        if (searchTerm) {
            const tbody = document.getElementById('tickets-tbody');
            if (!tbody) return;

            const rows = tbody.querySelectorAll('tr');
            let visibleCount = 0;
            
            rows.forEach(row => {
                if (row.querySelector('.tickets-empty') || row.querySelector('.search-no-results')) {
                    return;
                }
                
                const statusBadge = row.querySelector('.status-badge');
                const priorityBadge = row.querySelector('.priority-badge');
                
                if (!statusBadge || !priorityBadge) return;
                
                const status = statusBadge.textContent.trim().toLowerCase().replace(' ', '-');
                const priority = priorityBadge.textContent.trim().toLowerCase();
                
                const statusMatch = statusValue === 'all' || status === statusValue;
                const priorityMatch = priorityValue === 'all' || priority === priorityValue;
                
                if (statusMatch && priorityMatch) {
                    row.style.display = '';
                    visibleCount++;
                } else {
                    row.style.display = 'none';
                }
            });
            
            setTimeout(() => {
                this.highlightSearchTerms(searchTerm);
            }, 100);
            
            if (visibleCount === 0) {
                this.showFilterNoResults(searchTerm, statusValue, priorityValue);
            }
        } else {
            let filteredTickets = this.tickets;
            
            if (statusValue !== 'all') {
                filteredTickets = filteredTickets.filter(ticket => {
                    const ticketStatus = ticket.status.toLowerCase().replace(' ', '-');
                    return ticketStatus === statusValue;
                });
            }
            
            if (priorityValue !== 'all') {
                filteredTickets = filteredTickets.filter(ticket => {
                    return ticket.priority.toLowerCase() === priorityValue;
                });
            }
            
            const originalTickets = this.tickets;
            this.tickets = filteredTickets;
            this.loadTickets();
            
            if (filteredTickets.length === 0) {
                this.showFilterNoResults('', statusValue, priorityValue);
            }
            
            this.tickets = originalTickets;
        }
    }

    highlightSearchTerms(searchTerm) {
        if (!searchTerm.trim()) return;
        
        const tbody = document.getElementById('tickets-tbody');
        if (!tbody) return;
        
        this.clearSearchHighlights();
        
        const rows = tbody.querySelectorAll('tr:not([style*="display: none"])');
        
        rows.forEach(row => {
            const titleCell = row.querySelector('.ticket-title');
            const idCell = row.querySelector('.ticket-id');
            
            if (titleCell) {
                this.highlightTextInElement(titleCell, searchTerm);
            }
            if (idCell && searchTerm.replace('#', '') === idCell.textContent.replace('#', '')) {
                idCell.style.backgroundColor = '#fff3cd';
                idCell.style.fontWeight = 'bold';
            }
        });
    }

    highlightTextInElement(element, searchTerm) {
        const originalText = element.textContent;
        const searchRegex = new RegExp(`(${this.escapeRegex(searchTerm)})`, 'gi');
        
        if (searchRegex.test(originalText)) {
            const highlightedText = originalText.replace(searchRegex, 
                '<mark style="background-color: #fff3cd; padding: 2px 4px; border-radius: 3px; font-weight: bold;">$1</mark>'
            );
            element.innerHTML = highlightedText;
        }
    }

    clearSearchHighlights() {
        const tbody = document.getElementById('tickets-tbody');
        if (!tbody) return;
        
        tbody.querySelectorAll('.ticket-title mark').forEach(mark => {
            const parent = mark.parentNode;
            parent.replaceChild(document.createTextNode(mark.textContent), mark);
            parent.normalize();
        });
        
        tbody.querySelectorAll('.ticket-id').forEach(cell => {
            cell.style.backgroundColor = '';
            cell.style.fontWeight = '';
        });
        
        tbody.querySelectorAll('.ticket-title').forEach(titleCell => {
            if (titleCell.querySelector('mark')) {
                titleCell.textContent = titleCell.textContent;
            }
        });
    }

    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    showFilterNoResults(searchTerm, statusFilter, priorityFilter) {
        const tbody = document.getElementById('tickets-tbody');
        if (!tbody) return;
        
        let filterDescription = '';
        const filters = [];
        
        if (statusFilter !== 'all') {
            filters.push(`Status: ${statusFilter.replace('-', ' ')}`);
        }
        if (priorityFilter !== 'all') {
            filters.push(`Priority: ${priorityFilter}`);
        }
        if (searchTerm) {
            filters.push(`Search: "${searchTerm}"`);
        }
        
        if (filters.length > 0) {
            filterDescription = `with filters: ${filters.join(', ')}`;
        }
        
        const noResultsRow = document.createElement('tr');
        noResultsRow.innerHTML = `
            <td colspan="7" class="text-center" style="padding: 3rem;">
                <div class="filter-no-results">
                    <i class="fas fa-filter" style="font-size: 3rem; color: #cbd5e0; margin-bottom: 1rem;"></i>
                    <h3 style="color: #4a5568; margin-bottom: 0.5rem;">No tickets match your filters</h3>
                    <p style="color: #718096; margin-bottom: 1rem;">
                        No tickets found ${filterDescription}
                    </p>
                    <div style="display: flex; gap: 1rem; justify-content: center;">
                        <button class="btn btn-secondary clear-filters-btn">
                            <i class="fas fa-times"></i> Clear All Filters
                        </button>
                        <button class="btn btn-primary show-all-btn">
                            <i class="fas fa-list"></i> Show All Tickets
                        </button>
                    </div>
                </div>
            </td>
        `;
        
        tbody.innerHTML = '';
        tbody.appendChild(noResultsRow);
        
        const clearBtn = noResultsRow.querySelector('.clear-filters-btn');
        const showAllBtn = noResultsRow.querySelector('.show-all-btn');
        
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearAllFilters());
        }
        
        if (showAllBtn) {
            showAllBtn.addEventListener('click', () => this.resetToAllTickets());
        }
    }

    showSearchNoResults(searchTerm) {
        const tbody = document.getElementById('tickets-tbody');
        if (!tbody) return;
        
        const noResultsRow = document.createElement('tr');
        noResultsRow.innerHTML = `
            <td colspan="7" class="text-center" style="padding: 3rem;">
                <div class="search-no-results">
                    <i class="fas fa-search" style="font-size: 3rem; color: #cbd5e0; margin-bottom: 1rem;"></i>
                    <h3 style="color: #4a5568; margin-bottom: 0.5rem;">No tickets found</h3>
                    <p style="color: #718096; margin-bottom: 1rem;">
                        No tickets match your search for "<strong>${this.escapeHtml(searchTerm)}</strong>"
                    </p>
                    <button class="btn btn-secondary clear-search-btn">
                        <i class="fas fa-times"></i> Clear Search
                    </button>
                </div>
            </td>
        `;
        
        tbody.innerHTML = '';
        tbody.appendChild(noResultsRow);
        
        const clearBtn = noResultsRow.querySelector('.clear-search-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                const searchInput = document.getElementById('ticket-search');
                if (searchInput) {
                    searchInput.value = '';
                    this.searchTickets('');
                }
            });
        }
    }

    clearAllFilters() {
        const statusFilter = document.getElementById('status-filter');
        const priorityFilter = document.getElementById('priority-filter');
        const searchInput = document.getElementById('ticket-search');
        
        if (statusFilter) statusFilter.value = 'all';
        if (priorityFilter) priorityFilter.value = 'all';
        if (searchInput) searchInput.value = '';
        
        this.clearSearchHighlights();
        this.loadTickets();
    }

    resetToAllTickets() {
        this.clearAllFilters();
    }

loadAnalytics() {
        this.renderPriorityChart();
        this.renderTrendsChart();
    }

    renderPriorityChart() {
        const ctx = document.getElementById('priority-chart');
        if (!ctx) return;

        const priorityCounts = {
            critical: this.tickets.filter(t => t.priority === 'critical').length,
            high: this.tickets.filter(t => t.priority === 'high').length,
            medium: this.tickets.filter(t => t.priority === 'medium').length,
            low: this.tickets.filter(t => t.priority === 'low').length
        };

        if (this.priorityChart) {
            this.priorityChart.destroy();
        }

        this.priorityChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Critical', 'High', 'Medium', 'Low'],
                datasets: [{
                    data: [
                        priorityCounts.critical,
                        priorityCounts.high,
                        priorityCounts.medium,
                        priorityCounts.low
                    ],
                    backgroundColor: [
                        '#dc2626',
                        '#ea580c',
                        '#d97706',
                        '#16a34a'
                    ],
                    borderWidth: 2,
                    borderColor: '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 20,
                            usePointStyle: true,
                            font: {
                                size: 12
                            }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = ((context.parsed / total) * 100).toFixed(1);
                                return `${context.label}: ${context.parsed} (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    renderTrendsChart() {
        const ctx = document.getElementById('trends-chart');
        if (!ctx) return;

        const last7Days = [];
        const resolvedCounts = [];
        const createdCounts = [];

        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toDateString();
            
            last7Days.push(date.toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric' 
            }));

            const resolvedOnDate = this.tickets.filter(ticket => {
                if (!ticket.resolved_at) return false;
                const resolvedDate = new Date(ticket.resolved_at);
                return resolvedDate.toDateString() === dateStr;
            }).length;

            const createdOnDate = this.tickets.filter(ticket => {
                const createdDate = new Date(ticket.created_at);
                return createdDate.toDateString() === dateStr;
            }).length;

            resolvedCounts.push(resolvedOnDate);
            createdCounts.push(createdOnDate);
        }

        if (this.trendsChart) {
            this.trendsChart.destroy();
        }

        this.trendsChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: last7Days,
                datasets: [
                    {
                        label: 'Tickets Resolved',
                        data: resolvedCounts,
                        borderColor: '#16a34a',
                        backgroundColor: 'rgba(22, 163, 74, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4,
                        pointBackgroundColor: '#16a34a',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2,
                        pointRadius: 5
                    },
                    {
                        label: 'Tickets Created',
                        data: createdCounts,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4,
                        pointBackgroundColor: '#3b82f6',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2,
                        pointRadius: 5
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            padding: 20,
                            usePointStyle: true,
                            font: {
                                size: 12
                            }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        titleColor: '#ffffff',
                        bodyColor: '#ffffff',
                        borderColor: '#374151',
                        borderWidth: 1
                    }
                },
                scales: {
                    x: {
                        grid: {
                            display: false
                        },
                        ticks: {
                            font: {
                                size: 11
                            }
                        }
                    },
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(0, 0, 0, 0.1)'
                        },
                        ticks: {
                            stepSize: 1,
                            font: {
                                size: 11
                            }
                        }
                    }
                }
            }
        });
    }

    refreshAnalytics() {
        if (document.querySelector('[data-tab="analytics"].active')) {
            this.loadAnalytics();
        }
    }

openTicketModal(ticket = null) {
        const modal = document.getElementById('ticket-modal');
        const title = document.getElementById('modal-title');
        const form = document.getElementById('ticket-form');
        const commentsSection = document.getElementById('comments-section');
        
        if (!modal || !title || !form) return;
        
        this.populateAssigneeOptions();
        
        if (ticket) {
            title.textContent = 'Edit Ticket';
            this.editingTicket = ticket;
            this.populateTicketForm(ticket);
            
            if (commentsSection) {
                commentsSection.style.display = 'block';
            }
            
            this.loadAndDisplayComments(ticket.id);
        } else {
            title.textContent = 'Create New Ticket';
            this.editingTicket = null;
            form.reset();
            
            this.populateAssigneeOptions();
            
            if (commentsSection) {
                commentsSection.style.display = 'none';
            }
            
            const commentsList = document.getElementById('comments-list');
            if (commentsList) commentsList.innerHTML = '';
        }
        
        modal.classList.add('active');
    }

    openUserModal(user = null) {
        const modal = document.getElementById('user-modal');
        const title = document.getElementById('user-modal-title');
        const form = document.getElementById('user-form');
        
        if (user) {
            title.textContent = 'Edit User';
            this.editingUser = user; 
            this.populateUserForm(user);
        } else {
            title.textContent = 'Add New User';
            this.editingUser = null; 
            form.reset();
        }
        
        modal.classList.add('active');
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        modal.classList.remove('active');
    }

    populateAssigneeOptions() {
        const assigneeSelect = document.getElementById('ticket-assignee');
        if (!assigneeSelect) return;

        assigneeSelect.innerHTML = '<option value="">Unassigned</option>';
        
        this.users.filter(u => u.role === 'agent' || u.role === 'admin').forEach(user => {
            const option = document.createElement('option');
            option.value = user.id;
            option.textContent = user.name;
            assigneeSelect.appendChild(option);
        });
    }

    populateTicketForm(ticket) {
        this.populateAssigneeOptions();
        
        document.getElementById('ticket-title').value = ticket.title || '';
        document.getElementById('ticket-description').value = ticket.description || '';
        document.getElementById('ticket-priority').value = ticket.priority || 'low';
        document.getElementById('ticket-status').value = ticket.status || 'open';
        document.getElementById('ticket-category').value = ticket.category || 'other';
        
        const assigneeSelect = document.getElementById('ticket-assignee');
        if (assigneeSelect && ticket.assignee_id) {
            assigneeSelect.value = ticket.assignee_id;
        } else if (assigneeSelect) {
            assigneeSelect.value = '';
        }
    }

    populateUserForm(user) {
        document.getElementById('user-name').value = user.name;
        document.getElementById('user-email').value = user.email;
        document.getElementById('user-role').value = user.role;
    }

    showConfirmation(title, message, confirmText = 'Delete', cancelText = 'Cancel') {
        return new Promise((resolve) => {
            const modal = document.getElementById('confirmation-modal');
            const titleEl = document.getElementById('confirmation-title');
            const messageEl = document.getElementById('confirmation-message');
            const confirmBtn = document.getElementById('confirmation-confirm');
            const cancelBtn = document.getElementById('confirmation-cancel');

            titleEl.textContent = title;
            messageEl.textContent = message;
            confirmBtn.textContent = confirmText;
            cancelBtn.textContent = cancelText;

            modal.classList.add('active', 'confirmation-active');

            const handleConfirm = () => {
                modal.classList.remove('active', 'confirmation-active');
                cleanup();
                resolve(true);
            };

            const handleCancel = () => {
                modal.classList.remove('active', 'confirmation-active');
                cleanup();
                resolve(false);
            };

            const cleanup = () => {
                confirmBtn.removeEventListener('click', handleConfirm);
                cancelBtn.removeEventListener('click', handleCancel);
                modal.removeEventListener('click', handleModalClick);
                document.removeEventListener('keydown', handleKeydown);
            };

            const handleModalClick = (e) => {
                if (e.target === modal) {
                    handleCancel();
                }
            };

            const handleKeydown = (e) => {
                if (e.key === 'Escape') {
                    handleCancel();
                }
            };

            confirmBtn.addEventListener('click', handleConfirm);
            cancelBtn.addEventListener('click', handleCancel);
            modal.addEventListener('click', handleModalClick);
            document.addEventListener('keydown', handleKeydown);
        });
    }

    async resetDemoData() {
        const confirmed = await this.showConfirmation(
            'Clear All Data',
            'This will delete all current tickets, users, and activity data. The application will be reset to a clean state with no pre-made content.',
            'Clear All Data',
            'Cancel'
        );
        
        if (!confirmed) return;
        
        try {
            this.showLoading();
            
            const response = await this.authManager.makeAuthenticatedRequest('/api/users/reset-demo', {
                method: 'POST'
            });
            
            if (response.ok) {
                this.showNotification('All data cleared successfully!', 'success');
                
                this.tickets = [];
                this.users = this.users.filter(user => user.role === 'admin');
                this.dashboardData = {
                    recent_activity: [],
                    metrics: {
                        critical_count: 0,
                        high_count: 0,
                        open_count: 0,
                        resolved_today: 0
                    }
                };
                this.slaData = null;
                
                if (this.notificationManager) {
                    this.notificationManager.notifications = [];
                    this.notificationManager.unreadCount = 0;
                    this.notificationManager.updateBadge();
                    if (this.notificationManager.isOpen) {
                        this.notificationManager.renderNotifications();
                    }
                }
                
                this.updateDashboard();
                this.loadTickets();
                this.loadUsers();
                
                if (document.querySelector('[data-tab="analytics"].active')) {
                    this.loadAnalytics();
                }
                
            } else {
                const error = await response.json();
                this.showNotification(error.message || 'Failed to clear data', 'error');
            }
            
        } catch (error) {
            console.error('Clear data error:', error);
            this.showNotification('Failed to clear data. Please try again.', 'error');
        } finally {
            this.hideLoading();
        }
    }

    showLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.classList.add('active');
    }

    hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.classList.remove('active');
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type} show`;
        
        notification.innerHTML = `
            <i class="notification-icon fas fa-${this.getNotificationIcon(type)}"></i>
            <span class="notification-message">${this.escapeHtml(message)}</span>
            <button class="notification-close">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        document.body.appendChild(notification);
        
        const closeBtn = notification.querySelector('.notification-close');
        closeBtn.addEventListener('click', () => {
            notification.remove();
        });
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);
    }

    getNotificationIcon(type) {
        const icons = {
            'success': 'check-circle',
            'error': 'exclamation-circle',
            'warning': 'exclamation-triangle',
            'info': 'info-circle'
        };
        return icons[type] || 'info-circle';
    }

    getInitials(name) {
        return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    getActivityIcon(action) {
        const icons = {
            'ticket_created': 'plus-circle',
            'ticket_updated': 'edit',
            'ticket_resolved': 'check-circle',
            'ticket_assigned': 'user-plus',
            'ticket_escalated': 'exclamation-triangle',
            'ticket_closed': 'times-circle',
            'user_created': 'user-plus',
            'create': 'plus-circle',
            'update': 'edit',
            'assign': 'user-plus',
            'resolved': 'check-circle',
            'delete': 'trash',
            'status_change': 'exchange-alt'
        };
        return icons[action] || 'circle';
    }

    getTimeAgo(timestamp) {
        const now = new Date();
        const diff = now - new Date(timestamp);
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
        if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
        if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        return 'Just now';
    }
}

class NotificationManager {
    constructor(appInstance) {
        this.app = appInstance;
        this.notifications = [];
        this.isOpen = false;
        this.unreadCount = 0;
        this.refreshInterval = null;
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadNotificationsFromBackend();
        this.startAutoRefresh();
    }

    setupEventListeners() {
        const notificationBell = document.getElementById('notification-bell');
        const notificationDropdown = document.getElementById('notification-dropdown');
        const markAllRead = document.getElementById('mark-all-read');

        if (notificationBell) {
            notificationBell.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleDropdown();
            });
        }

        if (markAllRead) {
            markAllRead.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.markAllAsRead();
            });
        }

        if (notificationDropdown) {
            notificationDropdown.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }

        document.addEventListener('click', (e) => {
            const bell = document.getElementById('notification-bell');
            const dropdown = document.getElementById('notification-dropdown');
            
            if (!bell?.contains(e.target) && !dropdown?.contains(e.target)) {
                if (this.isOpen) {
                    this.closeDropdown();
                }
            }
        });
    }

    async loadNotificationsFromBackend() {
        try {
            const response = await this.app.authManager.makeAuthenticatedRequest('/api/notifications?limit=20');
            
            if (response.ok) {
                const data = await response.json();
                this.notifications = data.notifications || [];
                this.unreadCount = data.unread_count || 0;
                
                this.updateBadge();
                
                if (this.isOpen) {
                    this.renderNotifications();
                }
            }
        } catch (error) {
            // Silent fail for notifications
        }
    }

    startAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        
        this.refreshInterval = setInterval(() => {
            this.loadNotificationsFromBackend();
        }, 30000);
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    toggleDropdown() {
        if (this.isOpen) {
            this.closeDropdown();
        } else {
            this.openDropdown();
        }
    }

    openDropdown() {
        const dropdown = document.getElementById('notification-dropdown');
        
        if (dropdown) {
            dropdown.classList.add('active');
            this.isOpen = true;
            
            setTimeout(() => {
                this.renderNotifications();
            }, 150);
        }
    }

    closeDropdown() {
        const dropdown = document.getElementById('notification-dropdown');
        
        if (dropdown) {
            dropdown.classList.remove('active');
        }
        
        this.isOpen = false;
    }

    addNotification(type, title, message, data = {}) {
        const localNotification = {
            id: `local_${Date.now()}`,
            type,
            title,
            message,
            data,
            created_at: new Date().toISOString(),
            is_read: false,
            isLocal: true
        };

        this.notifications.unshift(localNotification);
        this.unreadCount++;
        this.updateBadge();

        if (this.isOpen) {
            this.renderNotifications();
        }

        setTimeout(() => {
            this.loadNotificationsFromBackend();
        }, 2000);
    }

    async markAllAsRead() {
        try {
            const unreadNotifications = this.notifications.filter(n => !n.is_read);
            
            if (unreadNotifications.length === 0) {
                return;
            }

            this.notifications.forEach(n => n.is_read = true);
            this.unreadCount = 0;
            this.updateBadge();
            this.renderNotifications();

            const response = await this.app.authManager.makeAuthenticatedRequest(
                '/api/notifications/read-all', 
                { method: 'PATCH' }
            );

            if (!response.ok) {
                await this.loadNotificationsFromBackend();
            }
        } catch (error) {
            await this.loadNotificationsFromBackend();
        }
    }

    updateBadge() {
        const badge = document.getElementById('notification-count');
        
        if (badge) {
            badge.textContent = this.unreadCount;
            if (this.unreadCount === 0) {
                badge.classList.add('hidden');
            } else {
                badge.classList.remove('hidden');
            }
        }
    }

    renderNotifications() {
        const container = document.getElementById('notification-list');
        if (!container) return;

        const unreadNotifications = this.notifications.filter(n => !n.is_read);

        if (unreadNotifications.length === 0) {
            container.innerHTML = `
                <div class="no-notifications">
                    <i class="fas fa-bell-slash"></i>
                    <p>No unread notifications</p>
                </div>
            `;
            return;
        }

        const notificationHTML = unreadNotifications.map(notification => {
            return `
                <div class="notification-item unread" 
                     data-notification-id="${notification.id}"
                     data-notification-type="${notification.type}">
                    <div class="notification-content">
                        <div class="notification-icon ${notification.type}">
                            <i class="fas fa-${this.getNotificationIcon(notification.type)}"></i>
                        </div>
                        <div class="notification-details">
                            <div class="notification-title">${this.escapeHtml(notification.title)}</div>
                            <div class="notification-message">${this.escapeHtml(notification.message)}</div>
                            <div class="notification-time">${this.getTimeAgo(notification.created_at)}</div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = notificationHTML;
        
        setTimeout(() => {
            this.attachClickListeners(container);
        }, 100);
    }

    attachClickListeners(container) {
        const items = container.querySelectorAll('.notification-item');

        items.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const notificationId = item.dataset.notificationId;
                
                if (this.isOpen) {
                    this.handleNotificationNavigation(notificationId);
                }
            });
        });
    }

    handleNotificationNavigation(notificationId) {
        const notification = this.notifications.find(n => n.id == notificationId);
        if (!notification) return;

        switch (notification.type) {
            case 'ticket_created':
            case 'ticket_updated':
            case 'ticket_assigned':
            case 'ticket_resolved':
                this.navigateToTickets();
                break;
            case 'user_created':
                this.navigateToUsers();
                break;
            default:
                this.navigateToTickets();
                break;
        }

        setTimeout(() => {
            this.closeDropdown();
        }, 300);
    }

    navigateToTickets() {
        const ticketsTab = document.querySelector('[data-tab="tickets"]');
        if (ticketsTab) {
            ticketsTab.click();
        }
    }

    navigateToUsers() {
        const usersTab = document.querySelector('[data-tab="users"]');
        if (usersTab) {
            usersTab.click();
        }
    }

    getNotificationIcon(type) {
        const icons = {
            'ticket_created': 'plus-circle',
            'ticket_updated': 'edit',
            'ticket_assigned': 'user-plus',
            'ticket_resolved': 'check-circle',
            'user_created': 'user-plus',
            'user_updated': 'edit'
        };
        return icons[type] || 'bell';
    }

    getTimeAgo(timestamp) {
        const now = new Date();
        const diff = now - new Date(timestamp);
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (days > 0) return `${days}d ago`;
        if (hours > 0) return `${hours}h ago`;
        if (minutes > 0) return `${minutes}m ago`;
        return 'Just now';
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    cleanup() {
        this.stopAutoRefresh();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        window.incidentTracker = new IncidentTracker();
        
        window.addEventListener('beforeunload', () => {
            if (window.incidentTracker?.notificationManager) {
                window.incidentTracker.notificationManager.cleanup();
            }
        });
    }, 100);
});