class DashboardManager {
    constructor(appInstance) {
        this.app = appInstance;
        this.refreshInterval = 30000;
        this.intervalId = null;
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupAutoRefresh();
    }

    setupEventListeners() {
        document.querySelectorAll('.metric-card').forEach(card => {
            card.addEventListener('click', () => {
                this.handleMetricCardClick(card);
            });
        });
    }

    handleMetricCardClick(card) {
        if (!this.app) return;
        
        const cardType = Array.from(card.classList).find(cls => 
            ['critical', 'high', 'open', 'resolved'].includes(cls)
        );
        
        if (cardType) {
            const ticketsTab = document.querySelector('[data-tab="tickets"]');
            if (ticketsTab) {
                ticketsTab.click();
                
                setTimeout(() => {
                    this.applyTicketFilter(cardType);
                }, 100);
            }
        }
    }

    applyTicketFilter(cardType) {
        const statusFilter = document.getElementById('status-filter');
        const priorityFilter = document.getElementById('priority-filter');
        
        if (!statusFilter || !priorityFilter) return;
        
        statusFilter.value = 'all';
        priorityFilter.value = 'all';
        
        switch (cardType) {
            case 'critical':
                priorityFilter.value = 'critical';
                break;
            case 'high':
                priorityFilter.value = 'high';
                break;
            case 'open':
                statusFilter.value = 'open';
                break;
            case 'resolved':
                statusFilter.value = 'resolved';
                break;
        }
        
        if (this.app && this.app.filterTickets) {
            this.app.filterTickets();
        }
    }

    setupAutoRefresh() {
        this.intervalId = setInterval(() => {
            if (document.visibilityState === 'visible' && 
                document.querySelector('[data-tab="dashboard"].active') &&
                this.app) {
                this.app.updateDashboard();
            }
        }, this.refreshInterval);
    }

    stopAutoRefresh() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    refresh() {
        if (this.app) {
            this.app.updateDashboard();
        }
    }
}

window.addEventListener('beforeunload', () => {
    if (window.dashboardManager) {
        window.dashboardManager.stopAutoRefresh();
    }
});