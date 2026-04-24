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

    function ensureSecretaryAllPassedLink() {
        const secretaryAccountTrigger = document.body.querySelector('#secretaryUser');
        const sidenav = document.body.querySelector('#layoutSidenav_nav .nav.accordion');

        if (!secretaryAccountTrigger || !sidenav) {
            return;
        }
        if (sidenav.querySelector('a.nav-link[href="secretary-all-passed.html"]')) {
            return;
        }

        const rankingLink = Array.from(sidenav.querySelectorAll('a.nav-link')).find(function (link) {
            const href = (link.getAttribute('href') || '').trim();
            return href === 'secretary-ranking.html';
        });

        if (!rankingLink) {
            return;
        }

        const allPassedLink = rankingLink.cloneNode(true);
        allPassedLink.setAttribute('href', 'secretary-all-passed.html');
        allPassedLink.innerHTML = '\n                                <div class="nav-link-icon"><i data-feather="check-circle"></i></div>\n                                All Passed\n                            ';

        rankingLink.insertAdjacentElement('afterend', allPassedLink);
    }

    function ensureSecretaryScholarSelectionLink() {
        const secretaryAccountTrigger = document.body.querySelector('#secretaryUser');
        const sidenav = document.body.querySelector('#layoutSidenav_nav .nav.accordion');

        if (!secretaryAccountTrigger || !sidenav) {
            return;
        }
        if (sidenav.querySelector('a.nav-link[href="secretary-scholar-selection.html"]')) {
            return;
        }

        const allPassedLink = Array.from(sidenav.querySelectorAll('a.nav-link')).find(function (link) {
            const href = (link.getAttribute('href') || '').trim();
            return href === 'secretary-all-passed.html';
        });
        const rankingLink = Array.from(sidenav.querySelectorAll('a.nav-link')).find(function (link) {
            const href = (link.getAttribute('href') || '').trim();
            return href === 'secretary-ranking.html';
        });
        const insertAfter = allPassedLink || rankingLink;

        if (!insertAfter) {
            return;
        }

        const scholarSelectionLink = insertAfter.cloneNode(true);
        scholarSelectionLink.setAttribute('href', 'secretary-scholar-selection.html');
        scholarSelectionLink.innerHTML = '\n                                <div class="nav-link-icon"><i data-feather="award"></i></div>\n                                Scholar Selection\n                            ';

        insertAfter.insertAdjacentElement('afterend', scholarSelectionLink);
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

    ensureSecretaryAllPassedLink();
    ensureSecretaryScholarSelectionLink();
    ensureAdminSpecialConsiderationLink();

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

    const targetAnchors = document.body.querySelectorAll('[href="' + activatedPath + '"].nav-link');

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
