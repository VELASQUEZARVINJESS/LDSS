/*!
    * Start Bootstrap - SB Admin Pro v2.0.4 (https://shop.startbootstrap.com/product/sb-admin-pro)
    * Copyright 2013-2022 Start Bootstrap
    * Licensed under SEE_LICENSE (https://github.com/StartBootstrap/sb-admin-pro/blob/master/LICENSE)
    */
(function () {
    if (typeof window.ldssShowToast === 'function') {
        return;
    }

    const recentToastKeys = {};

    function toastToneMeta(variant) {
        const tone = (variant || 'info').toString().trim().toLowerCase();

        if (tone === 'success') {
            return { badgeClass: 'bg-success', badgeText: 'Saved' };
        }
        if (tone === 'warning') {
            return { badgeClass: 'bg-warning text-dark', badgeText: 'Notice' };
        }
        if (tone === 'danger') {
            return { badgeClass: 'bg-danger', badgeText: 'Error' };
        }
        return { badgeClass: 'bg-primary', badgeText: 'Info' };
    }

    function shouldShowToast(key, dedupeMs) {
        const normalizedKey = (key || '').toString().trim();
        const windowMs = Number.isFinite(dedupeMs) ? dedupeMs : 1200;
        const now = Date.now();

        if (!normalizedKey) {
            return true;
        }
        if (recentToastKeys[normalizedKey] && (now - recentToastKeys[normalizedKey]) < windowMs) {
            return false;
        }
        recentToastKeys[normalizedKey] = now;
        return true;
    }

    function ensureToastContainer() {
        if (!document.body) {
            return null;
        }

        let container = document.getElementById('ldssToastViewport');
        if (container) {
            return container;
        }

        container = document.createElement('div');
        container.id = 'ldssToastViewport';
        container.className = 'toast-container position-fixed top-0 end-0 p-3';
        container.style.zIndex = '1085';
        document.body.appendChild(container);
        return container;
    }

    window.ldssShowToast = function (options) {
        const settings = (options && typeof options === 'object')
            ? options
            : { message: options };
        const message = settings.message ? settings.message.toString().trim() : '';
        const title = settings.title ? settings.title.toString().trim() : 'Notice';
        const variant = settings.variant ? settings.variant.toString().trim().toLowerCase() : 'info';
        const delay = Number.isFinite(settings.delay) ? settings.delay : (variant === 'danger' ? 4200 : 3200);
        const autohide = settings.autohide !== false;
        const key = settings.key || '';

        if (!message || !shouldShowToast(key || (variant + '|' + title + '|' + message), settings.dedupeMs)) {
            return null;
        }

        const container = ensureToastContainer();
        if (!container) {
            return null;
        }

        const tone = toastToneMeta(variant);
        const toastEl = document.createElement('div');
        toastEl.className = 'toast border-0 shadow-sm bg-white';
        toastEl.setAttribute('role', 'status');
        toastEl.setAttribute('aria-live', 'polite');
        toastEl.setAttribute('aria-atomic', 'true');

        const header = document.createElement('div');
        header.className = 'toast-header bg-white';

        const badge = document.createElement('span');
        badge.className = 'badge rounded-pill ' + tone.badgeClass + ' me-2';
        badge.textContent = tone.badgeText;

        const heading = document.createElement('strong');
        heading.className = 'me-auto';
        heading.textContent = title;

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'btn-close ms-2 mb-1';
        closeButton.setAttribute('data-bs-dismiss', 'toast');
        closeButton.setAttribute('aria-label', 'Close');

        const body = document.createElement('div');
        body.className = 'toast-body';
        body.textContent = message;

        header.appendChild(badge);
        header.appendChild(heading);
        header.appendChild(closeButton);
        toastEl.appendChild(header);
        toastEl.appendChild(body);
        container.appendChild(toastEl);

        toastEl.addEventListener('hidden.bs.toast', function () {
            toastEl.remove();
        });

        if (window.bootstrap && typeof window.bootstrap.Toast === 'function') {
            const toast = new window.bootstrap.Toast(toastEl, {
                autohide: autohide,
                delay: delay
            });
            toast.show();
            return toast;
        }

        toastEl.classList.add('show');
        window.setTimeout(function () {
            toastEl.remove();
        }, delay);
        return toastEl;
    };
})();

window.addEventListener('DOMContentLoaded', event => {
    // Small staged class to trigger restrained page-load motion
    requestAnimationFrame(() => {
        document.body.classList.add('ldss-ready');
    });

    function removeLegacySecretarySelectionLinks(sidenav) {
        Array.from(sidenav.children).forEach(function (node) {
            if (!node || typeof node.matches !== 'function') {
                return;
            }
            if (
                node.matches('a.nav-link[href="secretary-all-passed.html"]')
                || node.matches('a.nav-link[href="secretary-selection-pool.html"]')
                || node.matches('a.nav-link[href="secretary-scholar-selection.html"]')
                || node.matches('a.nav-link[href="secretary-final-selection.html"]')
                || node.matches('#secretaryScholarSelectionMenu')
            ) {
                node.remove();
            }
        });
    }

    function removeLegacySecretaryExamLinks(sidenav) {
        Array.from(sidenav.children).forEach(function (node) {
            if (!node || typeof node.matches !== 'function') {
                return;
            }
            if (
                node.matches('a.nav-link[href="secretary-exam-batches.html"]')
                || node.matches('a.nav-link[href="secretary-exam-results.html"]')
                || node.matches('a.nav-link[href="secretary-ranking.html"]')
                || node.matches('#secretaryExamManagementMenu')
            ) {
                node.remove();
            }
        });
    }

    function ensureSecretaryExamManagementMenu() {
        const secretaryAccountTrigger = document.body.querySelector('#secretaryUser');
        const sidenav = document.body.querySelector('#layoutSidenav_nav .nav.accordion');

        if (!secretaryAccountTrigger || !sidenav) {
            return;
        }

        removeLegacySecretaryExamLinks(sidenav);

        const applicationsLink = Array.from(sidenav.querySelectorAll('a.nav-link')).find(function (link) {
            const href = (link.getAttribute('href') || '').trim();
            return href === 'secretary-applications.html';
        });

        if (!applicationsLink) {
            return;
        }

        const examManagementWrap = document.createElement('div');
        examManagementWrap.id = 'secretaryExamManagementMenu';
        examManagementWrap.innerHTML = [
            '<a class="nav-link collapsed" href="javascript:void(0);" data-bs-toggle="collapse" data-bs-target="#secretaryExamManagementCollapse" aria-expanded="false" aria-controls="secretaryExamManagementCollapse">',
            '    <div class="nav-link-icon"><i data-feather="clipboard"></i></div>',
            '    Exam Management',
            '    <div class="sidenav-collapse-arrow"><i data-feather="chevron-down"></i></div>',
            '</a>',
            '<div class="collapse" id="secretaryExamManagementCollapse">',
            '    <nav class="sidenav-menu-nested nav">',
            '        <a class="nav-link" href="secretary-exam-batches.html">Room Assignment</a>',
            '        <a class="nav-link" href="secretary-exam-results.html">Score Exam</a>',
            '        <a class="nav-link" href="secretary-ranking.html">Ranking</a>',
            '    </nav>',
            '</div>'
        ].join('\n');

        applicationsLink.insertAdjacentElement('afterend', examManagementWrap);
    }

    function ensureSecretaryScholarSelectionLink() {
        const secretaryAccountTrigger = document.body.querySelector('#secretaryUser');
        const sidenav = document.body.querySelector('#layoutSidenav_nav .nav.accordion');

        if (!secretaryAccountTrigger || !sidenav) {
            return;
        }
        removeLegacySecretarySelectionLinks(sidenav);
        if (
            sidenav.querySelector('#secretaryScholarSelectionCollapse')
            || sidenav.querySelector('[data-bs-target="#secretaryScholarSelectionCollapse"]')
        ) {
            return;
        }

        const examManagementMenu = sidenav.querySelector('#secretaryExamManagementMenu');

        if (!examManagementMenu) {
            return;
        }

        const scholarSelectionWrap = document.createElement('div');
        scholarSelectionWrap.id = 'secretaryScholarSelectionMenu';
        scholarSelectionWrap.innerHTML = [
            '<a class="nav-link collapsed" href="javascript:void(0);" data-bs-toggle="collapse" data-bs-target="#secretaryScholarSelectionCollapse" aria-expanded="false" aria-controls="secretaryScholarSelectionCollapse">',
            '    <div class="nav-link-icon"><i data-feather="award"></i></div>',
            '    Selection',
            '    <div class="sidenav-collapse-arrow"><i data-feather="chevron-down"></i></div>',
            '</a>',
            '<div class="collapse" id="secretaryScholarSelectionCollapse">',
            '    <nav class="sidenav-menu-nested nav">',
            '        <a class="nav-link" href="secretary-all-passed.html">All Passed</a>',
            '        <a class="nav-link" href="secretary-selection-pool.html">Selection Pool</a>',
            '        <a class="nav-link" href="secretary-scholar-selection.html">Scholar Selection</a>',
            '        <a class="nav-link" href="secretary-final-selection.html">Final Selection</a>',
            '    </nav>',
            '</div>'
        ].join('\n');

        examManagementMenu.insertAdjacentElement('afterend', scholarSelectionWrap);
    }

    function ensureSecretarySubmittedApplicationsLink() {
        const secretaryAccountTrigger = document.body.querySelector('#secretaryUser');
        const sidenav = document.body.querySelector('#layoutSidenav_nav .nav.accordion');

        if (!secretaryAccountTrigger || !sidenav) {
            return;
        }
        if (
            sidenav.querySelector('a.nav-link[href="secretary-applications.html?view=requirements"]')
            || sidenav.querySelector('a.nav-link[href="secretary-applications.html?view=submitted_requirements"]')
        ) {
            return;
        }

        const scholarSelectionMenu = sidenav.querySelector('#secretaryScholarSelectionMenu');

        if (!scholarSelectionMenu) {
            return;
        }

        const submittedApplicationsLink = document.createElement('a');
        submittedApplicationsLink.className = 'nav-link';
        submittedApplicationsLink.setAttribute('href', 'secretary-applications.html?view=requirements');
        submittedApplicationsLink.innerHTML = '\n                                <div class="nav-link-icon"><i data-feather="file-text"></i></div>\n                                Requirements\n                            ';

        scholarSelectionMenu.insertAdjacentElement('afterend', submittedApplicationsLink);
    }

    function ensureSecretaryScreeningInterviewMenu() {
        const secretaryAccountTrigger = document.body.querySelector('#secretaryUser');
        const sidenav = document.body.querySelector('#layoutSidenav_nav .nav.accordion');

        if (!secretaryAccountTrigger || !sidenav) {
            return;
        }
        if (
            sidenav.querySelector('#secretaryScreeningInterviewCollapse')
            || sidenav.querySelector('[data-bs-target="#secretaryScreeningInterviewCollapse"]')
        ) {
            return;
        }

        const screeningWrap = document.createElement('div');
        screeningWrap.innerHTML = [
            '<a class="nav-link collapsed" href="javascript:void(0);" data-bs-toggle="collapse" data-bs-target="#secretaryScreeningInterviewCollapse" aria-expanded="false" aria-controls="secretaryScreeningInterviewCollapse">',
            '    <div class="nav-link-icon"><i data-feather="calendar"></i></div>',
            '    Interviews',
            '    <div class="sidenav-collapse-arrow"><i data-feather="chevron-down"></i></div>',
            '</a>',
            '<div class="collapse" id="secretaryScreeningInterviewCollapse">',
            '    <nav class="sidenav-menu-nested nav">',
            '        <a class="nav-link" href="secretary-interview.html">Scheduler</a>',
            '        <a class="nav-link" href="secretary-interview-attendances.html">Initial Screening</a>',
            '        <a class="nav-link" href="secretary-interview-attendance-list.html">Final Interview</a>',
            '    </nav>',
            '</div>'
        ].join('\n');

        const collapseToggle = screeningWrap.querySelector('[data-bs-target="#secretaryScreeningInterviewCollapse"]');
        if (collapseToggle && collapseToggle.classList.contains('active')) {
            collapseToggle.classList.remove('active');
        }

        sidenav.appendChild(screeningWrap);
    }

    function ensureSecretaryReportsAtBottom() {
        const secretaryAccountTrigger = document.body.querySelector('#secretaryUser');
        const sidenav = document.body.querySelector('#layoutSidenav_nav .nav.accordion');

        if (!secretaryAccountTrigger || !sidenav) {
            return;
        }

        const reportsLink = Array.from(sidenav.children).find(function (node) {
            return node
                && typeof node.matches === 'function'
                && node.matches('a.nav-link[href="secretary-reports.html"]');
        });

        if (!reportsLink) {
            return;
        }

        sidenav.appendChild(reportsLink);
    }

    function ensureAdminSpecialConsiderationLink() {
        const adminAccountTrigger = document.body.querySelector('#adminUser');
        const sidenav = document.body.querySelector('#layoutSidenav_nav .nav.accordion');

        if (!adminAccountTrigger || !sidenav) {
            return;
        }
        if (sidenav.querySelector('a.nav-link[href="admin-approval-queue.html?view=special_consideration"]')) {
            return;
        }

        const dashboardLink = Array.from(sidenav.querySelectorAll('a.nav-link')).find(function (link) {
            const href = (link.getAttribute('href') || '').trim();
            return href === 'admin-dashboard.html';
        });
        if (!dashboardLink) {
            return;
        }

        const specialConsiderationLink = dashboardLink.cloneNode(true);
        specialConsiderationLink.setAttribute('href', 'admin-approval-queue.html?view=special_consideration');
        specialConsiderationLink.innerHTML = '\n                                <div class="nav-link-icon"><i data-feather="bookmark"></i></div>\n                                Special Consideration\n                            ';

        dashboardLink.insertAdjacentElement('afterend', specialConsiderationLink);
    }

    function ensureSuperAdminSpecialConsiderationLink() {
        const superAdminAccountTrigger = document.body.querySelector('#superAdminUser');
        const sidenav = document.body.querySelector('#layoutSidenav_nav .nav.accordion');

        if (!superAdminAccountTrigger || !sidenav) {
            return;
        }
        if (sidenav.querySelector('a.nav-link[href="super-admin-special-consideration.html"]')) {
            return;
        }

        const scholarshipSettingsLink = Array.from(sidenav.querySelectorAll('a.nav-link')).find(function (link) {
            const href = (link.getAttribute('href') || '').trim();
            return href === 'super-admin-scholarship-settings.html';
        });
        if (!scholarshipSettingsLink) {
            return;
        }

        const specialConsiderationLink = scholarshipSettingsLink.cloneNode(true);
        specialConsiderationLink.setAttribute('href', 'super-admin-special-consideration.html');
        specialConsiderationLink.innerHTML = '\n                                <div class="nav-link-icon"><i data-feather="bookmark"></i></div>\n                                Special Consideration\n                            ';

        scholarshipSettingsLink.insertAdjacentElement('afterend', specialConsiderationLink);
    }

    ensureSecretaryExamManagementMenu();
    ensureSecretaryScholarSelectionLink();
    ensureSecretarySubmittedApplicationsLink();
    ensureSecretaryScreeningInterviewMenu();
    ensureSecretaryReportsAtBottom();
    ensureAdminSpecialConsiderationLink();
    ensureSuperAdminSpecialConsiderationLink();

    // Activate feather only when the icon library is available
    if (window.feather && typeof window.feather.replace === 'function') {
        window.feather.replace();
    }

    if (document.body.querySelector('#applicantUser')) {
        document.body.classList.add('ldss-applicant-portal');
    }

    const hasBootstrap = typeof window.bootstrap !== 'undefined';

    // Enable tooltips globally
    if (hasBootstrap) {
        var tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
        tooltipTriggerList.map(function (tooltipTriggerEl) {
            return new bootstrap.Tooltip(tooltipTriggerEl);
        });
    }

    // Enable popovers globally
    if (hasBootstrap) {
        var popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'));
        popoverTriggerList.map(function (popoverTriggerEl) {
            return new bootstrap.Popover(popoverTriggerEl);
        });
    }

    // Activate Bootstrap scrollspy for the sticky nav component
    const stickyNav = document.body.querySelector('#stickyNav');
    if (stickyNav && hasBootstrap) {
        new bootstrap.ScrollSpy(document.body, {
            target: '#stickyNav',
            offset: 82,
        });
    }

    // Toggle the side navigation
    const sidebarToggle = document.body.querySelector('#sidebarToggle');
    const BOOTSTRAP_LG_WIDTH = 992;
    let desktopSidebarCollapsed = localStorage.getItem('sb|sidebar-toggle') === 'true';

    function syncSidebarState() {
        if (window.innerWidth >= BOOTSTRAP_LG_WIDTH) {
            document.body.classList.toggle('sidenav-toggled', desktopSidebarCollapsed);
            return;
        }

        // Keep mobile sidenav temporary so phone pages never reopen with a blocking overlay.
        document.body.classList.remove('sidenav-toggled');
    }

    if (sidebarToggle) {
        syncSidebarState();

        sidebarToggle.addEventListener('click', event => {
            event.preventDefault();

            if (window.innerWidth >= BOOTSTRAP_LG_WIDTH) {
                desktopSidebarCollapsed = !desktopSidebarCollapsed;
                document.body.classList.toggle('sidenav-toggled', desktopSidebarCollapsed);
                localStorage.setItem('sb|sidebar-toggle', desktopSidebarCollapsed);
                return;
            }

            document.body.classList.toggle('sidenav-toggled');
        });

        window.addEventListener('resize', syncSidebarState);
    }

    // Close side navigation when width < LG
    const sidenavContent = document.body.querySelector('#layoutSidenav_content');
    if (sidenavContent) {
        sidenavContent.addEventListener('click', event => {
            if (window.innerWidth >= 992) {
                return;
            }
            if (document.body.classList.contains("sidenav-toggled")) {
                document.body.classList.toggle("sidenav-toggled");
            }
        });
    }

    // Add active state to sidbar nav links
    let activatedPath = window.location.pathname.match(/([\w-]+\.html)/, '$1');

    if (activatedPath) {
        activatedPath = activatedPath[0];
    } else {
        activatedPath = 'index.html';
    }

    const viewParam = new URLSearchParams(window.location.search || '').get('view');
    let targetAnchorSelector = '[href="' + activatedPath + '"].nav-link';

    if (activatedPath === 'secretary-applications.html' && (viewParam === 'requirements' || viewParam === 'submitted_requirements')) {
        targetAnchorSelector = [
            '[href="secretary-applications.html?view=requirements"].nav-link',
            '[href="secretary-applications.html?view=submitted_requirements"].nav-link'
        ].join(', ');
    } else if (activatedPath === 'admin-approval-queue.html' && viewParam === 'special_consideration') {
        targetAnchorSelector = '[href="admin-approval-queue.html?view=special_consideration"].nav-link';
    }

    const targetAnchors = document.body.querySelectorAll(targetAnchorSelector);

    targetAnchors.forEach(targetAnchor => {
        let parentNode = targetAnchor.parentNode;
        while (parentNode !== null && parentNode !== document.documentElement) {
            if (parentNode.classList.contains('collapse')) {
                parentNode.classList.add('show');
                const parentNavLink = document.body.querySelector(
                    '[data-bs-target="#' + parentNode.id + '"]'
                );
                parentNavLink.classList.remove('collapsed');
                parentNavLink.classList.add('active');
            }
            parentNode = parentNode.parentNode;
        }
        targetAnchor.classList.add('active');
    });
});
