/*!
    * Start Bootstrap - SB Admin Pro v2.0.4 (https://shop.startbootstrap.com/product/sb-admin-pro)
    * Copyright 2013-2022 Start Bootstrap
    * Licensed under SEE_LICENSE (https://github.com/StartBootstrap/sb-admin-pro/blob/master/LICENSE)
    */
    window.addEventListener('DOMContentLoaded', event => {
    // Small staged class to trigger restrained page-load motion
    requestAnimationFrame(() => {
        document.body.classList.add('ldss-ready');
    });

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
